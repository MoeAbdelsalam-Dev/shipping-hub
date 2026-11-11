import type { Booking, CarrierAdapter, Label, Quote } from "./types";

/**
 * OT — local courier, NO API. STUB (Phase 2). Not registered in index.ts yet.
 *
 * How OT works today (manual):
 *   1. On the Shopify order page, staff click OT's order action button.
 *   2. An OT page opens with the order pre-filled (address, order number...).
 *   3. Staff enter, per box: length / width / height (cm) and weight (kg) —
 *      multi-piece, often 18+ boxes — plus Residential / Commercial.
 *   4. OT shows quotes from its sub-couriers; staff pick one, book, print
 *      OT's labels.
 *   GTA + residential orders skip step 3: open in OT and print its label.
 *
 * Plan: automate that page. Driver is decided after recon:
 *   A) Playwright on the server (Railway) with an OT login stored as secrets, or
 *   B) a Chrome extension on the work PC that fills the page the staff member
 *      already has open (uses their existing OT session; no credentials on our
 *      server).
 * Either way this adapter is the only code that knows OT's page structure.
 * Quote ids must look like "ot:<sub-courier>:<service>:<ref>" so
 * carriers/index.ts can route book() back here.
 *
 * Recon checklist (fill in CLAUDE.md "OT recon" when done):
 *   - exact URL pattern of the pre-filled order page (-> config/ot.json)
 *   - login / session lifetime, 2FA?
 *   - form field selectors for boxes, "add piece", res/com toggle
 *   - how quotes are rendered; how a quote is booked
 *   - label format (PDF/ZPL) and how to download it; tracking numbers
 *   - rate limits / ToS on automating the page
 */

function notYet(): never {
  throw new Error("OT adapter not implemented yet (Phase 2)");
}

export const otCarrier: CarrierAdapter = {
  id: "ot",
  name: "OT",

  // Signature: getQuotes(order: ShipOrder, boxes: Box[], addressType: AddressType)
  async getQuotes(): Promise<Quote[]> {
    return notYet();
  },

  // Signature: book(quoteId: string)
  async book(): Promise<Booking> {
    return notYet();
  },

  // Signature: getLabels(shipmentId: string)
  async getLabels(): Promise<Label[]> {
    return notYet();
  },
};
