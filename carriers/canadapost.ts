import { carrierEnv, hasAllEnv, NotImplementedError } from "./env";
import type { Booking, CarrierAdapter, Label, Quote } from "./types";

/**
 * Canada Post — official API (Basic auth with API username/password). STUB:
 * reads its settings from env so "connected" status works; rating/contract
 * shipments are built in Release 2.
 *
 * Env: CP_API_USERNAME, CP_API_PASSWORD, CP_CUSTOMER_NUMBER, CP_CONTRACT_NUMBER
 * (Canada Post Developer Program), CP_ENV = sandbox | production.
 *
 * Field mapping (config/carrier_fields.json): name = customer, company =
 * company, customer-ref-1 = order number. "Signature required" = Signature
 * (SO option). PO Boxes are sent as-is (Canada Post delivers to them).
 */

const REQUIRED = ["CP_API_USERNAME", "CP_API_PASSWORD", "CP_CUSTOMER_NUMBER", "CP_CONTRACT_NUMBER"];

export const canadaPostCarrier: CarrierAdapter = {
  id: "canadapost",
  name: "Canada Post",
  requiredEnv: REQUIRED,
  isConnected: () => hasAllEnv(REQUIRED),

  // Signature: getQuotes(order, boxes, addressType, options)
  async getQuotes(): Promise<Quote[]> {
    void carrierEnv("CP_ENV"); // sandbox: ct.soa-gw.canadapost.ca, production: soa-gw.canadapost.ca
    throw new NotImplementedError("Canada Post rating");
  },
  async book(): Promise<Booking> {
    throw new NotImplementedError("Canada Post shipments");
  },
  async getLabels(): Promise<Label[]> {
    throw new NotImplementedError("Canada Post labels");
  },
};
