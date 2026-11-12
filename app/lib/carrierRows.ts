import type { Quote } from "../../carriers/types";
import type { CarrierId, MappedFields } from "./rules";

/** One row per carrier on the quotes list. Browser-safe. */
export interface CarrierRow {
  carrierId: CarrierId;
  carrierName: string;
  /**
   * connected      — keys present; quotes come from the adapter
   * not-connected  — keys missing ("Not connected — needs …")
   * unavailable    — rule says no (e.g. PO Box only — Canada Post only)
   * error          — connected but the quote request failed
   */
  status: "connected" | "not-connected" | "unavailable" | "error";
  /** Missing env var names (never values). */
  needs: string[];
  /** Who/where provides the keys, for the "needs …" text. */
  setupWhere: string;
  message: string | null;
  /** Customer's most-used courier. */
  usual: boolean;
  /** What this courier will receive (null when unavailable). */
  fields: MappedFields | null;
  poBoxNote: string | null;
  quotes: Quote[];
}

export function needsText(row: CarrierRow): string {
  return `Not connected — needs ${row.needs.join(", ")} (${row.setupWhere})`;
}

export interface BestQuote {
  carrierName: string;
  quote: Quote;
}

/**
 * Cheapest quote overall, and fastest (fewest transit days; ties → cheaper).
 * Considers every quote shown, including SAMPLE ones (the UI says so).
 */
export function bestQuotes(rows: CarrierRow[]): {
  cheapest: BestQuote | null;
  fastest: BestQuote | null;
} {
  const all = rows.flatMap((r) => r.quotes.map((quote) => ({ carrierName: r.carrierName, quote })));
  if (all.length === 0) return { cheapest: null, fastest: null };
  const cheapest = all.reduce((a, b) => (b.quote.totalCad < a.quote.totalCad ? b : a));
  const timed = all.filter((x) => x.quote.transitDays !== undefined);
  const fastest = timed.length
    ? timed.reduce((a, b) => {
        const da = a.quote.transitDays!;
        const db = b.quote.transitDays!;
        return db < da || (db === da && b.quote.totalCad < a.quote.totalCad) ? b : a;
      })
    : null;
  return { cheapest, fastest };
}
