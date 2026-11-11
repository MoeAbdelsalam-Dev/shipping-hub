/**
 * Courier names from Shopify's fulfillment "tracking company" are free text.
 * Normalize them so history counts and the "Usual" quote badge line up.
 * Browser-safe.
 */

export const UNKNOWN_COURIER = "Unknown";

const ALIASES: Record<string, string> = {
  canadapost: "Canada Post",
  postescanada: "Canada Post",
  ups: "UPS",
  unitedparcelservice: "UPS",
  fedex: "FedEx",
  federalexpress: "FedEx",
  ot: "OT",
};

/** Comparison key: lowercase letters/digits only. */
export function courierKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Display name; blank and "Other" become "Unknown". */
export function normalizeCourier(name: string | null | undefined): string {
  const key = courierKey(name);
  if (!key || key === "other" || key === "unknown") return UNKNOWN_COURIER;
  return ALIASES[key] ?? (name ?? "").trim();
}

/** True when a quote's carrier is the customer's usual courier. */
export function isUsualCourier(
  quoteCarrierName: string,
  usual: string | null | undefined,
): boolean {
  if (!usual || usual === UNKNOWN_COURIER) return false;
  return courierKey(normalizeCourier(quoteCarrierName)) === courierKey(usual);
}

export interface CourierHistory {
  /** Previous orders found for this customer (max 10; ~60 days without read_all_orders). */
  previousOrders: number;
  /** Most-used known courier, or null when there is no history / no known courier. */
  usual: { courier: string; count: number } | null;
  last: {
    courier: string;
    date: string;
    orderName: string;
    trackingNumbers: string[];
  } | null;
  /** Guest checkout: no customer record to look up. */
  guest: boolean;
}

/** "First-time customer" / "N previous orders · Usually ships with: X (x of N)". */
export function historySummary(h: CourierHistory): string {
  if (h.guest) return "Guest checkout — no customer history.";
  if (h.previousOrders === 0) return "First-time customer";
  const orders = `${h.previousOrders} previous order${h.previousOrders === 1 ? "" : "s"}`;
  const usual = h.usual
    ? `Usually ships with: ${h.usual.courier} (${h.usual.count} of ${h.previousOrders})`
    : `Usually ships with: ${UNKNOWN_COURIER}`;
  return `${orders} · ${usual}`;
}
