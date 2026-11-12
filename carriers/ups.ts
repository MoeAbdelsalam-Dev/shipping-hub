import { carrierEnv, hasAllEnv, NotImplementedError } from "./env";
import type { Booking, CarrierAdapter, Label, Quote } from "./types";

/**
 * UPS — official API (OAuth client credentials). STUB: reads its settings from
 * env so "connected" status works; quoting/booking are built in Release 2.
 *
 * Env: UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_NUMBER (UPS Developer
 * Portal), UPS_ENV = sandbox | production (default sandbox).
 *
 * Field mapping (config/carrier_fields.json): ShipTo.Name = company || customer,
 * AttentionName = customer, no reference. "Signature required" =
 * Adult Signature Required. PO Boxes are stripped before we get the order.
 */

const REQUIRED = ["UPS_CLIENT_ID", "UPS_CLIENT_SECRET", "UPS_ACCOUNT_NUMBER"];

export const upsCarrier: CarrierAdapter = {
  id: "ups",
  name: "UPS",
  requiredEnv: REQUIRED,
  isConnected: () => hasAllEnv(REQUIRED),

  // Signature: getQuotes(order, boxes, addressType, options)
  async getQuotes(): Promise<Quote[]> {
    void carrierEnv("UPS_ENV"); // sandbox: wwwcie.ups.com, production: onlinetools.ups.com
    throw new NotImplementedError("UPS rating");
  },
  async book(): Promise<Booking> {
    throw new NotImplementedError("UPS booking");
  },
  async getLabels(): Promise<Label[]> {
    throw new NotImplementedError("UPS labels");
  },
};
