import db from "../../db.server";
import type { ShipAddress } from "../../../carriers/types";
import { missingEnv } from "../../../carriers/env";
import { getJudge, type JudgeOutput } from "./judge.server";
import { getSearchProvider, type SearchResult } from "./search.server";
import { MAX_EVIDENCE, type Classification, type Evidence, type Verdict } from "./types";

/**
 * Mirrors the manual process:
 *  1. search the full address INCLUDING the unit,
 *  2. Claude reads the top results,
 *  3. if a business name recurs, search "<business>" + city to confirm it is
 *     really at this address, and judge again with both result sets,
 *  4. return verdict + one-line reason + up to 5 evidence links.
 * Results are cached per (shop, normalized address). The classifier never sets
 * the shipment's address type — staff must click Confirm.
 */

export const CLASSIFIER_ENV = ["BRAVE_SEARCH_API_KEY", "ANTHROPIC_API_KEY"];

/** Env names still missing for the address check (empty = ready). */
export function classifierNeeds(): string[] {
  return process.env.CLASSIFIER_DEMO === "1" ? [] : missingEnv(CLASSIFIER_ENV);
}

export class ClassifierNotConnectedError extends Error {
  constructor() {
    super("Address check not connected");
    this.name = "ClassifierNotConnectedError";
  }
}

/** "Unit 1203, 55 Main St" style query, unit included. */
export function addressQuery(a: ShipAddress): string {
  return [a.address1, a.address2, a.city, a.provinceCode, a.postalCode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/** Cache key: same street, unit, city, postal code => same answer. */
export function addressKey(a: ShipAddress): string {
  return [a.address1, a.address2, a.city, a.provinceCode, a.postalCode, a.countryCode]
    .map((p) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim())
    .join("|");
}

function toClassification(row: {
  verdict: string;
  confidence: number;
  reason: string;
  evidenceJson: string;
  source: string;
  updatedAt: Date;
  confirmedType: string | null;
}): Classification {
  let evidence: Evidence[] = [];
  try {
    evidence = JSON.parse(row.evidenceJson);
  } catch {
    evidence = [];
  }
  const v = row.verdict;
  const c = row.confirmedType;
  return {
    verdict: v === "residential" || v === "commercial" ? v : "unsure",
    confidence: row.confidence,
    reason: row.reason,
    evidence,
    source: row.source === "live" ? "live" : "mock",
    checkedAt: row.updatedAt.toISOString(),
    confirmedType: c === "residential" || c === "commercial" ? c : null,
  };
}

export async function getCachedClassification(
  shop: string,
  address: ShipAddress,
): Promise<Classification | null> {
  const row = await db.addressCheck.findUnique({
    where: { shop_addressKey: { shop, addressKey: addressKey(address) } },
  });
  // Old demo-data rows are not shown as real results.
  if (!row || (row.source === "mock" && process.env.CLASSIFIER_DEMO !== "1")) return null;
  return toClassification(row);
}

async function runClassifier(address: ShipAddress): Promise<{
  result: JudgeOutput;
  evidence: Evidence[];
  live: boolean;
}> {
  const search = getSearchProvider();
  const judge = getJudge();
  if (!search || !judge) throw new ClassifierNotConnectedError();

  const results = (await search.search(addressQuery(address), 10)).slice(0, 10);
  let result = await judge.judge({
    address: addressQuery(address),
    company: address.company ?? null,
    results,
  });
  let all: SearchResult[] = results;

  if (result.recurringBusinessName) {
    const name = result.recurringBusinessName;
    const followResults = (
      await search.search(`"${name}" ${address.city}`.trim(), 5)
    ).slice(0, 5);
    result = await judge.judge({
      address: addressQuery(address),
      company: address.company ?? null,
      results,
      followUp: { businessName: name, results: followResults },
    });
    all = [...results, ...followResults];
  }

  const seen = new Set<number>();
  const evidence = result.evidenceIndexes
    .filter((i) => Number.isInteger(i) && i >= 0 && i < all.length && !seen.has(i) && seen.add(i))
    .slice(0, MAX_EVIDENCE)
    .map((i) => all[i]);

  return {
    result,
    evidence,
    live: search.id !== "mock" && judge.id !== "mock",
  };
}

/** Cached unless force=true (the "Check again" button). */
export async function classifyAddress(
  shop: string,
  address: ShipAddress,
  { force = false }: { force?: boolean } = {},
): Promise<Classification> {
  if (!force) {
    const cached = await getCachedClassification(shop, address);
    if (cached) return cached;
  }
  if (!address.address1 || !address.city) {
    return {
      verdict: "unsure",
      confidence: 0,
      reason: "Address is incomplete — contact the customer.",
      evidence: [],
      source: "mock",
      checkedAt: new Date().toISOString(),
      confirmedType: null,
    };
  }

  const { result, evidence, live } = await runClassifier(address);
  const key = addressKey(address);
  const data = {
    verdict: result.verdict,
    confidence: result.confidence,
    reason: result.reason.slice(0, 300),
    evidenceJson: JSON.stringify(evidence),
    source: live ? "live" : "mock",
  };
  const row = await db.addressCheck.upsert({
    where: { shop_addressKey: { shop, addressKey: key } },
    create: { shop, addressKey: key, ...data },
    update: data,
  });
  return toClassification(row);
}

/** Staff clicked Confirm (or picked a type manually): remember it for this address. */
export async function recordConfirmation(
  shop: string,
  address: ShipAddress,
  confirmed: Exclude<Verdict, "unsure">,
): Promise<void> {
  const key = addressKey(address);
  await db.addressCheck.upsert({
    where: { shop_addressKey: { shop, addressKey: key } },
    create: {
      shop,
      addressKey: key,
      verdict: "unsure",
      confidence: 0,
      reason: "Not checked automatically.",
      evidenceJson: "[]",
      source: "mock",
      confirmedType: confirmed,
      confirmedAt: new Date(),
    },
    update: { confirmedType: confirmed, confirmedAt: new Date() },
  });
}
