import rulesConfig from "../../config/rules.json";
import fieldsConfig from "../../config/carrier_fields.json";
import type { AddressType, ShipAddress, ShipOrder } from "../../carriers/types";
import type { Zone } from "./gta";

/**
 * Shipping rules, driven by config/rules.json and config/carrier_fields.json.
 * Pure and browser-safe. Unit tests: app/lib/rules.test.ts (`npm test`).
 */

export type CarrierId = "ups" | "canadapost" | "ot";
export const CARRIER_IDS: CarrierId[] = ["ups", "canadapost", "ot"];

type FieldExpr = string | null;
interface CarrierConfig {
  name: string;
  fields: {
    name: FieldExpr;
    attention: FieldExpr;
    company: FieldExpr;
    reference: FieldExpr;
    phone: FieldExpr;
    email: FieldExpr;
  };
  poBox: "allow" | "strip";
  signature: string | null;
  requiredEnv: string[];
  setupWhere: string;
}

export const CARRIERS = fieldsConfig.carriers as Record<CarrierId, CarrierConfig>;

export function carrierName(id: CarrierId): string {
  return CARRIERS[id].name;
}

// ------------------------------------------------------------------ routing

export type ShipRoute = "needs-address-type" | "print-in-ot" | "quotes";

/** GTA + residential skips quotes: one "Print in OT" button. */
export function shipRoute(zone: Zone, addressType: AddressType | null): ShipRoute {
  if (!addressType) return "needs-address-type";
  if (zone === "GTA" && addressType === "residential") return "print-in-ot";
  return "quotes";
}

export const GTA_RESIDENTIAL_CARRIER = rulesConfig.gtaResidentialCarrier as CarrierId;

// ------------------------------------------------------------------ PO Box

const PO_BOX_RES = rulesConfig.poBoxPatterns.map((p) => new RegExp(p, "gi"));

function stripPoBox(line: string): { rest: string; found: boolean } {
  let rest = line;
  let found = false;
  for (const re of PO_BOX_RES) {
    re.lastIndex = 0;
    if (re.test(rest)) {
      found = true;
      re.lastIndex = 0;
      rest = rest.replace(re, " ");
    }
  }
  rest = rest
    .replace(/\s*[,;]\s*(?=[,;]|$)/g, "")
    .replace(/^[\s,;#-]+|[\s,;#-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { rest, found };
}

/** A street address needs a number and a word, e.g. "123 Main St". */
function looksLikeStreet(line: string): boolean {
  return /\d/.test(line) && /[a-z]{2,}/i.test(line);
}

export interface PoBoxInfo {
  isPoBox: boolean;
  /** Address lines with the PO Box removed, or null if no street address is left. */
  street: { address1: string; address2: string | null } | null;
}

export function detectPoBox(address1: string, address2?: string | null): PoBoxInfo {
  const l1 = stripPoBox(address1 ?? "");
  const l2 = stripPoBox(address2 ?? "");
  const isPoBox = l1.found || l2.found;
  if (!isPoBox) {
    return { isPoBox: false, street: { address1, address2: address2 ?? null } };
  }
  const lines = [l1.rest, l2.rest].filter(Boolean);
  if (!lines.some(looksLikeStreet)) return { isPoBox: true, street: null };
  // Keep the street line first; anything left over (e.g. "Unit 4") as line 2.
  const streetIdx = lines.findIndex(looksLikeStreet);
  const street = lines[streetIdx];
  const other = lines.filter((_, i) => i !== streetIdx).join(", ") || null;
  return { isPoBox: true, street: { address1: street, address2: other } };
}

export type CarrierAddress =
  | { ok: true; address: ShipAddress; poBoxNote: string | null }
  | { ok: false; reason: string };

export const PO_BOX_ONLY_REASON = "PO Box only — Canada Post only";

/** The address a given carrier receives, after the PO Box rule. */
export function addressForCarrier(id: CarrierId, shipTo: ShipAddress): CarrierAddress {
  const po = detectPoBox(shipTo.address1, shipTo.address2);
  if (!po.isPoBox) return { ok: true, address: shipTo, poBoxNote: null };
  if (CARRIERS[id].poBox === "allow") {
    return { ok: true, address: shipTo, poBoxNote: "PO Box → CP" };
  }
  if (!po.street) return { ok: false, reason: PO_BOX_ONLY_REASON };
  return {
    ok: true,
    address: { ...shipTo, address1: po.street.address1, address2: po.street.address2 },
    poBoxNote: "PO Box removed — street address used",
  };
}

// ------------------------------------------------------------ signature

/** What "Signature required" means for this carrier, or null if not offered. */
export function signatureOption(id: CarrierId, required: boolean): string | null {
  if (!required) return null;
  return CARRIERS[id].signature;
}

// ------------------------------------------------------- field mapping

export interface MappedFields {
  name: string;
  attention: string | null;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  provinceCode: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
  email: string | null;
  reference: string | null;
  residential: boolean | null;
  signature: string | null;
}

function evalExpr(expr: FieldExpr, order: ShipOrder, addr: ShipAddress): string | null {
  if (!expr) return null;
  const values: Record<string, string | null | undefined> = {
    customer: addr.name,
    company: addr.company,
    orderNumber: order.orderNumber,
    email: order.email,
    phone: addr.phone,
  };
  for (const part of expr.split("||")) {
    const v = values[part.trim()];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

export type CarrierFieldsResult =
  | { ok: true; fields: MappedFields; poBoxNote: string | null }
  | { ok: false; reason: string };

export function mapCarrierFields(
  id: CarrierId,
  order: ShipOrder,
  opts: { addressType: AddressType | null; signatureRequired: boolean },
): CarrierFieldsResult {
  const ca = addressForCarrier(id, order.shipTo);
  if (!ca.ok) return ca;
  const a = ca.address;
  const f = CARRIERS[id].fields;
  return {
    ok: true,
    poBoxNote: ca.poBoxNote,
    fields: {
      name: evalExpr(f.name, order, a) ?? "",
      attention: evalExpr(f.attention, order, a),
      company: evalExpr(f.company, order, a),
      address1: a.address1,
      address2: a.address2 ?? null,
      city: a.city,
      provinceCode: a.provinceCode,
      postalCode: a.postalCode,
      countryCode: a.countryCode,
      phone: evalExpr(f.phone, order, a),
      email: evalExpr(f.email, order, a),
      reference: evalExpr(f.reference, order, a),
      residential: opts.addressType ? opts.addressType === "residential" : null,
      signature: signatureOption(id, opts.signatureRequired),
    },
  };
}

/** The ShipOrder an adapter receives: same order, carrier-specific address. */
export function orderForCarrier(id: CarrierId, order: ShipOrder): ShipOrder | null {
  const ca = addressForCarrier(id, order.shipTo);
  return ca.ok ? { ...order, shipTo: ca.address } : null;
}
