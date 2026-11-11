/**
 * Address classifier types. Browser-safe (no secrets, no Node APIs) so the
 * shipment page and the order-page extension can render results.
 */

export type Verdict = "residential" | "commercial" | "unsure";

export interface Evidence {
  title: string;
  url: string;
  snippet: string;
}

export interface Classification {
  verdict: Verdict;
  /** 0..1 */
  confidence: number;
  /** One line, shown to staff. */
  reason: string;
  /** At most 5 links that support the verdict. */
  evidence: Evidence[];
  /** "live" = real search + Claude; "mock" = demo data (no API keys yet). */
  source: "live" | "mock";
  checkedAt: string;
  /** What staff confirmed for this address last time, if anything. */
  confirmedType: "residential" | "commercial" | null;
}

export const MAX_EVIDENCE = 5;
