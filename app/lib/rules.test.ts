import { describe, expect, it } from "vitest";

import type { ShipOrder } from "../../carriers/types";
import { historySummary, isUsualCourier, normalizeCourier } from "./courier";
import { zoneFor } from "./gta";
import {
  PO_BOX_ONLY_REASON,
  addressForCarrier,
  detectPoBox,
  mapCarrierFields,
  shipRoute,
  signatureOption,
} from "./rules";

const order = (over: Partial<ShipOrder["shipTo"]> = {}): ShipOrder => ({
  id: "gid://shopify/Order/1",
  name: "#1001",
  orderNumber: "1001",
  email: "pat@example.com",
  shipTo: {
    name: "Pat Lee",
    company: "Lee Dental",
    address1: "123 Main St",
    address2: null,
    city: "Toronto",
    provinceCode: "ON",
    postalCode: "M5V 2T6",
    countryCode: "CA",
    phone: "416-555-0100",
    ...over,
  },
});

describe("routing", () => {
  it("GTA + residential skips quotes (Print in OT)", () => {
    expect(shipRoute("GTA", "residential")).toBe("print-in-ot");
  });
  it("everything else gets quotes", () => {
    expect(shipRoute("GTA", "commercial")).toBe("quotes");
    expect(shipRoute("Non-GTA", "residential")).toBe("quotes");
    expect(shipRoute("Non-GTA", "commercial")).toBe("quotes");
  });
  it("waits for Residential/Commercial", () => {
    expect(shipRoute("GTA", null)).toBe("needs-address-type");
  });
  it("zones from postal code", () => {
    expect(zoneFor("m5v 2t6", "CA")).toBe("GTA");
    expect(zoneFor("K1A 0B1", "CA")).toBe("Non-GTA");
  });
});

describe("PO Box detection", () => {
  it.each([
    "PO Box 123",
    "P.O. Box 123",
    "p.o box 9",
    "POB 77",
    "Box 45",
    "C.P. 210",
    "CP 210",
    "Case postale 18",
    "General Delivery",
    "Post Office Box 5",
  ])("detects %s", (line) => {
    expect(detectPoBox(line).isPoBox).toBe(true);
  });

  it.each(["123 Main St", "55 Boxwood Cres", "10 Bay St, Unit 4", "1 Cpt Rd"])(
    "does not flag %s",
    (line) => {
      expect(detectPoBox(line).isPoBox).toBe(false);
    },
  );

  it("keeps the street when one remains", () => {
    expect(detectPoBox("123 Main St", "PO Box 45").street).toEqual({
      address1: "123 Main St",
      address2: null,
    });
    expect(detectPoBox("PO Box 45, 123 Main St").street?.address1).toBe("123 Main St");
  });

  it("returns no street for PO Box only", () => {
    expect(detectPoBox("PO Box 45").street).toBeNull();
    expect(detectPoBox("General Delivery", "").street).toBeNull();
  });
});

describe("carrier addresses", () => {
  it("Canada Post gets the full address with a PO Box → CP note", () => {
    const r = addressForCarrier("canadapost", order({ address1: "PO Box 45" }).shipTo);
    expect(r.ok && r.address.address1).toBe("PO Box 45");
    expect(r.ok && r.poBoxNote).toBe("PO Box → CP");
  });
  it("UPS / OT get the street with the PO Box stripped", () => {
    const o = order({ address1: "123 Main St", address2: "PO Box 45" });
    for (const id of ["ups", "ot"] as const) {
      const r = addressForCarrier(id, o.shipTo);
      expect(r.ok && r.address.address1).toBe("123 Main St");
      expect(r.ok && r.address.address2).toBeNull();
    }
  });
  it("UPS / OT refuse a PO Box-only address", () => {
    const o = order({ address1: "PO Box 45" });
    expect(addressForCarrier("ups", o.shipTo)).toEqual({ ok: false, reason: PO_BOX_ONLY_REASON });
    expect(addressForCarrier("ot", o.shipTo)).toEqual({ ok: false, reason: PO_BOX_ONLY_REASON });
  });
  it("normal addresses pass through untouched", () => {
    const r = addressForCarrier("ups", order().shipTo);
    expect(r.ok && r.poBoxNote).toBeNull();
  });
});

describe("signature required", () => {
  it("maps per carrier", () => {
    expect(signatureOption("ups", true)).toBe("Adult Signature Required");
    expect(signatureOption("canadapost", true)).toBe("Signature");
    expect(signatureOption("ups", false)).toBeNull();
  });
});

describe("field mapping", () => {
  const opts = { addressType: "commercial" as const, signatureRequired: false };
  it("UPS: name = company || customer, attention = customer, no reference", () => {
    const r = mapCarrierFields("ups", order(), opts);
    expect(r.ok && r.fields).toMatchObject({
      name: "Lee Dental",
      attention: "Pat Lee",
      reference: null,
    });
    const noCompany = mapCarrierFields("ups", order({ company: "" }), opts);
    expect(noCompany.ok && noCompany.fields.name).toBe("Pat Lee");
  });
  it("Canada Post: name = customer, company = company, reference = order number", () => {
    const r = mapCarrierFields("canadapost", order(), opts);
    expect(r.ok && r.fields).toMatchObject({
      name: "Pat Lee",
      company: "Lee Dental",
      reference: "1001",
      email: "pat@example.com",
    });
  });
});

describe("courier history", () => {
  it("normalizes blank / Other to Unknown", () => {
    expect(normalizeCourier("")).toBe("Unknown");
    expect(normalizeCourier("Other")).toBe("Unknown");
    expect(normalizeCourier("canada_post")).toBe("Canada Post");
  });
  it("summarizes", () => {
    expect(historySummary({ previousOrders: 0, usual: null, last: null, guest: false })).toBe(
      "First-time customer",
    );
    expect(
      historySummary({
        previousOrders: 5,
        usual: { courier: "UPS", count: 3 },
        last: null,
        guest: false,
      }),
    ).toBe("5 previous orders · Usually ships with: UPS (3 of 5)");
  });
  it("marks the usual courier", () => {
    expect(isUsualCourier("Canada Post", "Canada Post")).toBe(true);
    expect(isUsualCourier("UPS", "Canada Post")).toBe(false);
    expect(isUsualCourier("UPS", "Unknown")).toBe(false);
  });
});
