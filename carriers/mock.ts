import type {
  AddressType,
  Booking,
  Box,
  CarrierAdapter,
  Label,
  Quote,
  ShipOrder,
} from "./types";

/**
 * Fake carrier for Phase 1. Prices are made up but react to the inputs
 * (weight, dimensional weight, box count, residential surcharge) so the
 * shipment screen can be tested end to end.
 */

const DIM_DIVISOR = 5000; // cm^3 per kg, a common courier divisor
const RESIDENTIAL_SURCHARGE_PER_BOX = 4.5;

export function billableKg(box: Box): number {
  const dim = (box.lengthCm * box.widthCm * box.heightCm) / DIM_DIVISOR;
  return Math.max(box.weightKg, dim);
}

const SERVICES = [
  { code: "GROUND", name: "Mock Ground", base: 12, perKg: 0.9, days: 4 },
  { code: "EXPRESS", name: "Mock Express", base: 22, perKg: 1.8, days: 2 },
  { code: "OVERNIGHT", name: "Mock Overnight", base: 38, perKg: 2.9, days: 1 },
];

const bookings = new Map<string, Booking>();

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export const mockCarrier: CarrierAdapter = {
  id: "mock",
  name: "Mock Carrier",

  async getQuotes(
    order: ShipOrder,
    boxes: Box[],
    addressType: AddressType,
  ): Promise<Quote[]> {
    if (boxes.length === 0) return [];
    const kg = boxes.reduce((sum, b) => sum + billableKg(b), 0);
    const far = order.shipTo.provinceCode !== "ON" ? 1.6 : 1;

    return SERVICES.map((s) => {
      const freight = round2((s.base * boxes.length + s.perKg * kg) * far);
      const resi =
        addressType === "residential"
          ? round2(RESIDENTIAL_SURCHARGE_PER_BOX * boxes.length)
          : 0;
      const fuel = round2((freight + resi) * 0.18);
      return {
        id: `mock:${s.code}:${order.id}:${boxes.length}`,
        carrierId: "mock",
        carrierName: "Mock Carrier",
        serviceName: s.name,
        totalCad: round2(freight + resi + fuel),
        transitDays: s.days + (far > 1 ? 2 : 0),
        breakdown: [
          { label: "Freight", amountCad: freight },
          ...(resi ? [{ label: "Residential", amountCad: resi }] : []),
          { label: "Fuel", amountCad: fuel },
        ],
      };
    });
  },

  async book(quoteId: string): Promise<Booking> {
    const boxCount = Number(quoteId.split(":").pop()) || 1;
    const shipmentId = `mockship_${Date.now()}`;
    const booking: Booking = {
      shipmentId,
      carrierId: "mock",
      trackingNumbers: Array.from(
        { length: boxCount },
        (_, i) => `MOCK${Date.now()}${String(i + 1).padStart(2, "0")}`,
      ),
    };
    bookings.set(shipmentId, booking);
    return booking;
  },

  async getLabels(shipmentId: string): Promise<Label[]> {
    const booking = bookings.get(shipmentId);
    if (!booking) throw new Error(`Unknown mock shipment ${shipmentId}`);
    return booking.trackingNumbers.map((_, i) => ({
      boxIndex: i,
      format: "PDF" as const,
      url: `about:blank#mock-label-${shipmentId}-${i + 1}`,
    }));
  },
};
