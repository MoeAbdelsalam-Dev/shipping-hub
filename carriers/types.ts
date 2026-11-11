/**
 * Carrier adapter contract. Our carriers are OT (local courier, no API -
 * automated via its web page), UPS, Canada Post and FedEx. Each is one file in
 * /carriers implementing CarrierAdapter; the app only talks to this interface.
 *
 * Units are always metric (cm, kg) and money is always CAD in this layer.
 * Adapters convert to whatever their API / page wants.
 */

export type AddressType = "residential" | "commercial";

export interface ShipAddress {
  name: string;
  company?: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  provinceCode: string;
  postalCode: string;
  countryCode: string;
  phone?: string | null;
}

/** The slice of a Shopify order a carrier needs. */
export interface ShipOrder {
  /** Shopify GID, e.g. gid://shopify/Order/123 */
  id: string;
  /** Display name, e.g. #1001 */
  name: string;
  /**
   * Order number without "#", e.g. "1001". Every adapter puts this in the
   * carrier's reference field (Canada Post, OT, UPS, FedEx) so labels and
   * invoices can be matched back to the Shopify order.
   */
  orderNumber: string;
  /**
   * Customer contact email from the order. Used only for the carrier's own
   * tracking notifications. Never log it.
   */
  email: string | null;
  shipTo: ShipAddress;
}

/** One physical package. A shipment can have many (we've seen 18+). */
export interface Box {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  /** Preset name from config/boxes.json, if it came from one. */
  presetName?: string;
}

export interface Quote {
  /** Opaque, adapter-owned id. Pass back to book(). Must encode the carrier. */
  id: string;
  carrierId: string;
  carrierName: string;
  serviceName: string;
  totalCad: number;
  transitDays?: number;
  /** Surcharges etc., for display only. */
  breakdown?: { label: string; amountCad: number }[];
}

export interface Booking {
  /** Adapter-owned shipment id. Pass to getLabels(). */
  shipmentId: string;
  carrierId: string;
  /** One per box, same order as the boxes array. */
  trackingNumbers: string[];
}

export interface Label {
  boxIndex: number;
  format: "PDF" | "ZPL" | "PNG";
  /** Either a URL the carrier hosts, or base64 file content. */
  url?: string;
  base64?: string;
}

export interface CarrierAdapter {
  readonly id: string;
  readonly name: string;
  getQuotes(
    order: ShipOrder,
    boxes: Box[],
    addressType: AddressType,
  ): Promise<Quote[]>;
  book(quoteId: string): Promise<Booking>;
  getLabels(shipmentId: string): Promise<Label[]>;
}
