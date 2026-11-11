import { mockCarrier } from "./mock";
import type {
  AddressType,
  Box,
  CarrierAdapter,
  Quote,
  ShipOrder,
} from "./types";

export * from "./types";

/**
 * Registered carriers. Today only the mock. Planned:
 *   ot.ts (Phase 2, page automation - stub exists, not registered yet),
 *   ups.ts / canadapost.ts / fedex.ts (Phase 3, official APIs).
 * Register an adapter only when its credentials/config are present.
 */
export const carriers: CarrierAdapter[] = [mockCarrier];

export function getCarrier(id: string): CarrierAdapter {
  const c = carriers.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown carrier "${id}"`);
  return c;
}

/** Quote id format is "<carrierId>:<anything>", so we can route book(). */
export function carrierForQuote(quoteId: string): CarrierAdapter {
  return getCarrier(quoteId.split(":")[0]);
}

export interface QuoteAllResult {
  quotes: Quote[];
  errors: { carrierId: string; message: string }[];
}

/** Ask every carrier in parallel; one failing carrier never blocks the rest. */
export async function quoteAll(
  order: ShipOrder,
  boxes: Box[],
  addressType: AddressType,
): Promise<QuoteAllResult> {
  const results = await Promise.allSettled(
    carriers.map((c) => c.getQuotes(order, boxes, addressType)),
  );
  const quotes: Quote[] = [];
  const errors: QuoteAllResult["errors"] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") quotes.push(...r.value);
    else
      errors.push({
        carrierId: carriers[i].id,
        message: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
  });
  quotes.sort((a, b) => a.totalCad - b.totalCad);
  return { quotes, errors };
}
