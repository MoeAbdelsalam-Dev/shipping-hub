import { describe, expect, it } from "vitest";

import { bestQuotes, type CarrierRow } from "./carrierRows";

const row = (
  carrierName: string,
  quotes: [string, number, number?][],
): CarrierRow => ({
  carrierId: "ups",
  carrierName,
  status: "not-connected",
  needs: [],
  setupWhere: "",
  message: null,
  usual: false,
  fields: null,
  poBoxNote: null,
  quotes: quotes.map(([serviceName, totalCad, transitDays], i) => ({
    id: `${carrierName}:${i}`,
    carrierId: "x",
    carrierName,
    serviceName,
    totalCad,
    transitDays,
  })),
});

describe("bestQuotes", () => {
  it("finds cheapest and fastest across carriers", () => {
    const r = bestQuotes([
      row("UPS", [
        ["Standard", 30, 3],
        ["Express", 55, 1],
      ]),
      row("Canada Post", [
        ["Regular", 22, 4],
        ["Xpresspost", 48, 1],
      ]),
    ]);
    expect(r.cheapest?.quote.serviceName).toBe("Regular");
    expect(r.cheapest?.carrierName).toBe("Canada Post");
    // Both 1 day: the cheaper one wins.
    expect(r.fastest?.quote.serviceName).toBe("Xpresspost");
  });
  it("is empty without quotes", () => {
    expect(bestQuotes([row("UPS", [])])).toEqual({
      cheapest: null,
      fastest: null,
    });
  });
});
