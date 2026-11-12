import { carriers, missingEnv } from "../../carriers";
import { sampleQuotes } from "../../carriers/sample";
import type { AddressType, Box, ShipOrder } from "../../carriers/types";
import type { CarrierRow } from "./carrierRows";
import { isUsualCourier } from "./courier";
import { CARRIERS, mapCarrierFields, orderForCarrier, type CarrierId } from "./rules";

/**
 * Builds the per-carrier rows (UPS, Canada Post, OT): connection status, what
 * each courier receives, and — when asked — quotes.
 *
 * Read-only build: connected adapters are stubs that throw "not built yet",
 * so no carrier is ever called; sample quotes are generated locally.
 */

interface RowOptions {
  addressType: AddressType | null;
  signatureRequired: boolean;
  usualCourier: string | null;
}

export function carrierRows(order: ShipOrder, opts: RowOptions): CarrierRow[] {
  return carriers.map((c) => {
    const id = c.id as CarrierId;
    const mapped = mapCarrierFields(id, order, opts);
    const needs = missingEnv(c.requiredEnv);
    const base = {
      carrierId: id,
      carrierName: c.name,
      needs,
      setupWhere: CARRIERS[id].setupWhere,
      usual: isUsualCourier(c.name, opts.usualCourier),
      quotes: [],
    };
    if (!mapped.ok) {
      return {
        ...base,
        status: "unavailable",
        message: mapped.reason,
        fields: null,
        poBoxNote: null,
      } satisfies CarrierRow;
    }
    return {
      ...base,
      status: needs.length ? "not-connected" : "connected",
      message: null,
      fields: mapped.fields,
      poBoxNote: mapped.poBoxNote,
    } satisfies CarrierRow;
  });
}

export async function quoteRows(
  order: ShipOrder,
  boxes: Box[],
  addressType: AddressType,
  opts: RowOptions & { sample: boolean },
): Promise<CarrierRow[]> {
  const rows = carrierRows(order, opts);
  return Promise.all(
    rows.map(async (row): Promise<CarrierRow> => {
      if (row.status === "unavailable") return row;
      const carrierOrder = orderForCarrier(row.carrierId, order)!;
      if (row.status === "not-connected") {
        return opts.sample
          ? {
              ...row,
              quotes: sampleQuotes(
                row.carrierId,
                row.carrierName,
                carrierOrder.shipTo.provinceCode,
                boxes,
                addressType,
                { signatureRequired: opts.signatureRequired },
              ),
            }
          : row;
      }
      const adapter = carriers.find((c) => c.id === row.carrierId)!;
      try {
        const quotes = await adapter.getQuotes(carrierOrder, boxes, addressType, {
          signatureRequired: opts.signatureRequired,
        });
        return { ...row, quotes: quotes.sort((a, b) => a.totalCad - b.totalCad) };
      } catch (e) {
        // Error text from our own stubs/adapters; never includes customer data.
        const msg = e instanceof Error && e.name === "NotImplementedError"
          ? `Connected — quoting for ${row.carrierName} is not built yet (Release 2).`
          : `${row.carrierName} quote failed. Try again or check the Setup page.`;
        console.error(`Quote failed for ${row.carrierId}:`, e instanceof Error ? e.name : "error");
        return { ...row, status: "error", message: msg };
      }
    }),
  );
}
