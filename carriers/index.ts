import { canadaPostCarrier } from "./canadapost";
import { missingEnv } from "./env";
import { otCarrier } from "./ot";
import type { CarrierAdapter } from "./types";
import { upsCarrier } from "./ups";

export * from "./types";
export { missingEnv } from "./env";

/**
 * Every carrier we use, in display order. Each one reports "connected" only
 * when all its env vars are set; app/lib/quotes.server.ts shows a row per
 * carrier either way ("Not connected — needs …" otherwise).
 */
export const carriers: CarrierAdapter[] = [upsCarrier, canadaPostCarrier, otCarrier];

export function getCarrier(id: string): CarrierAdapter {
  const c = carriers.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown carrier "${id}"`);
  return c;
}

/** Quote id format is "<carrierId>:<anything>", so we can route book(). */
export function carrierForQuote(quoteId: string): CarrierAdapter {
  return getCarrier(quoteId.split(":")[0]);
}

/** Env var names still missing for a carrier (names only, never values). */
export function carrierNeeds(id: string): string[] {
  return missingEnv(getCarrier(id).requiredEnv);
}
