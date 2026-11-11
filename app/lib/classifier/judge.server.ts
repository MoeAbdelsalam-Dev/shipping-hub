import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import type { SearchResult } from "./search.server";
import type { Verdict } from "./types";

/**
 * Reads search results for an address and decides residential / commercial /
 * unsure. Live: Claude API (ANTHROPIC_API_KEY). Otherwise a rule-based mock.
 */

export interface JudgeInput {
  /** Full address as searched, including unit. */
  address: string;
  /** Company field from the Shopify order, if any (hint only). */
  company: string | null;
  /** Results for the address search, numbered from 0. */
  results: SearchResult[];
  /** Second search on a recurring business name + city, if one was run. */
  followUp?: { businessName: string; results: SearchResult[] };
}

export interface JudgeOutput {
  verdict: Verdict;
  confidence: number;
  reason: string;
  /** Indexes into [...results, ...followUp.results]. */
  evidenceIndexes: number[];
  /** A business name that recurs in the results, worth a confirming search. */
  recurringBusinessName: string | null;
}

export interface Judge {
  readonly id: string;
  judge(input: JudgeInput): Promise<JudgeOutput>;
}

// ------------------------------------------------------------------ Claude

const JudgeSchema = z.object({
  verdict: z.enum(["residential", "commercial", "unsure"]),
  confidence: z.number(),
  reason: z.string(),
  evidence_indexes: z.array(z.number().int()),
  recurring_business_name: z.string().nullable(),
});

const SYSTEM = `You classify a Canadian shipping address as residential or commercial for a courier booking, the way an experienced shipping clerk does it by Googling the address.

You get numbered web search results for the full address (including any unit number), and sometimes a second set of results for a business name + city.

Rules:
- Residential evidence: real-estate or rental listings for that address or unit (realtor.ca, condos.ca, rentals, Kijiji/Zillow-style listings), a unit inside a residential condo/apartment tower, a detached house with no business at it.
- Commercial evidence: a business listed AT this exact address (and unit, if one is given) — company website contact page, Google/Yelp/Yellow Pages business listing, office/warehouse/retail/plaza/industrial unit.
- A business elsewhere in the same building but at a different unit is NOT evidence for this unit. Mixed-use buildings need unit-level evidence.
- Home-based businesses registered at a house still count as residential for delivery.
- If a business name recurs in the address results and there is no second result set yet, put it in recurring_business_name so we can run a confirming search; otherwise set it to null.
- If the evidence is thin, conflicting, or about a different address, answer "unsure". Do not guess. Staff will contact the customer.
- The order's company field is a hint only; customers often fill it in for home addresses.

Output: verdict, confidence between 0 and 1, reason as ONE short line a clerk can read at a glance, evidence_indexes (up to 5 result numbers that support the verdict, most convincing first), recurring_business_name.`;

function formatResults(results: SearchResult[], offset: number) {
  if (results.length === 0) return "(no results)";
  return results
    .map(
      (r, i) =>
        `[${i + offset}] ${r.title}\n    ${r.url}\n    ${r.snippet}`,
    )
    .join("\n");
}

export function claudeJudge(): Judge {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const model = process.env.CLASSIFIER_MODEL?.trim() || "claude-opus-5-5";

  return {
    id: `claude:${model}`,
    async judge(input) {
      const first = input.results.length;
      let content =
        `Address searched: ${input.address}\n` +
        `Company field on the order: ${input.company || "(empty)"}\n\n` +
        `Search results for the address:\n${formatResults(input.results, 0)}`;
      if (input.followUp) {
        content +=
          `\n\nSecond search for "${input.followUp.businessName}" + city:\n` +
          formatResults(input.followUp.results, first);
      }

      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        // Simple classification: low effort keeps it fast and cheap.
        output_config: { effort: "low", format: betaZodOutputFormat(JudgeSchema) },
        // If the model declines, the API retries on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        messages: [{ role: "user", content }],
      });

      const out = response.parsed_output;
      if (response.stop_reason === "refusal" || !out) {
        return {
          verdict: "unsure",
          confidence: 0,
          reason: "Automatic check could not decide — check manually.",
          evidenceIndexes: [],
          recurringBusinessName: null,
        };
      }
      return {
        verdict: out.verdict,
        confidence: Math.min(1, Math.max(0, out.confidence)),
        reason: out.reason,
        evidenceIndexes: out.evidence_indexes,
        recurringBusinessName: input.followUp ? null : out.recurring_business_name,
      };
    },
  };
}

// -------------------------------------------------------------------- mock

const HOME_HINTS =
  /realtor|mls|condo|for rent|for sale|rental|apartment|bedroom|residential/i;

/** The most frequent capitalised "Name Inc./Ltd./Corp." style phrase, if repeated. */
function recurringBusiness(results: SearchResult[]): string | null {
  const counts = new Map<string, number>();
  for (const r of results) {
    const m = `${r.title} ${r.snippet}`.match(
      /([A-Z][\w&'-]*(?: [A-Z][\w&'-]*)* (?:Inc|Ltd|Corp|LLC|Co)\.?)/,
    );
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

export const mockJudge: Judge = {
  id: "mock",
  async judge(input) {
    const all = [...input.results, ...(input.followUp?.results ?? [])];
    const homeIdx = all
      .map((r, i) => (HOME_HINTS.test(`${r.title} ${r.snippet} ${r.url}`) ? i : -1))
      .filter((i) => i >= 0);

    if (input.followUp && input.followUp.results.length > 0) {
      return {
        verdict: "commercial",
        confidence: 0.85,
        reason: `${input.followUp.businessName} is listed at this address.`,
        evidenceIndexes: all.map((_, i) => i).slice(0, 5),
        recurringBusinessName: null,
      };
    }
    const business = recurringBusiness(input.results);
    if (business && !input.followUp) {
      return {
        verdict: "unsure",
        confidence: 0.4,
        reason: `"${business}" appears repeatedly; confirming it is at this address.`,
        evidenceIndexes: [0, 1].filter((i) => i < all.length),
        recurringBusinessName: business,
      };
    }
    if (homeIdx.length > 0) {
      return {
        verdict: "residential",
        confidence: 0.75,
        reason: "Listed as a home/condo (real-estate or rental listing).",
        evidenceIndexes: homeIdx.slice(0, 5),
        recurringBusinessName: null,
      };
    }
    return {
      verdict: "unsure",
      confidence: 0.2,
      reason: "No useful search results for this address.",
      evidenceIndexes: [],
      recurringBusinessName: null,
    };
  },
};

export function getJudge(): Judge {
  return process.env.ANTHROPIC_API_KEY?.trim() ? claudeJudge() : mockJudge;
}
