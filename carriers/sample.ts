import type { AddressType, Box, Quote, QuoteOptions } from "./types";

/**
 * "Preview with sample prices": clearly labelled, made-up quotes so the whole
 * flow can be shown before carriers are connected. Never bookable
 * (sample: true), never sent anywhere. No network.
 */

const DIM_DIVISOR = 5000; // cm³ per kg

function billableKg(b: Box) {
  return Math.max(b.weightKg, (b.lengthCm * b.widthCm * b.heightCm) / DIM_DIVISOR);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const SERVICES: Record<string, { name: string; base: number; perKg: number; days: number }[]> = {
  ups: [
    { name: "UPS Standard", base: 14, perKg: 1.1, days: 3 },
    { name: "UPS Express Saver", base: 26, perKg: 2.0, days: 1 },
  ],
  canadapost: [
    { name: "Regular Parcel", base: 12, perKg: 0.95, days: 4 },
    { name: "Expedited Parcel", base: 15, perKg: 1.2, days: 2 },
    { name: "Xpresspost", base: 22, perKg: 1.9, days: 1 },
  ],
  ot: [
    { name: "via sub-courier — Ground", base: 11, perKg: 0.85, days: 3 },
    { name: "via sub-courier — Express", base: 20, perKg: 1.7, days: 1 },
  ],
};

export function sampleQuotes(
  carrierId: string,
  carrierName: string,
  provinceCode: string,
  boxes: Box[],
  addressType: AddressType,
  options: QuoteOptions = {},
): Quote[] {
  const services = SERVICES[carrierId] ?? [];
  if (boxes.length === 0) return [];
  const kg = boxes.reduce((s, b) => s + billableKg(b), 0);
  const far = provinceCode === "ON" ? 1 : 1.6;
  return services.map((svc, i) => {
    const freight = round2((svc.base * boxes.length + svc.perKg * kg) * far);
    const resi = addressType === "residential" ? round2(4.5 * boxes.length) : 0;
    const sig = options.signatureRequired ? round2(carrierId === "ups" ? 7.5 : 2.5) : 0;
    const fuel = round2((freight + resi + sig) * 0.18);
    return {
      id: `${carrierId}:sample:${i}`,
      carrierId,
      carrierName,
      serviceName: svc.name,
      totalCad: round2(freight + resi + sig + fuel),
      transitDays: svc.days + (far > 1 ? 2 : 0),
      breakdown: [
        { label: "Freight", amountCad: freight },
        ...(resi ? [{ label: "Residential", amountCad: resi }] : []),
        ...(sig ? [{ label: "Signature", amountCad: sig }] : []),
        { label: "Fuel", amountCad: fuel },
      ],
      sample: true,
    };
  });
}
