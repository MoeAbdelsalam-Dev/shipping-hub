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
