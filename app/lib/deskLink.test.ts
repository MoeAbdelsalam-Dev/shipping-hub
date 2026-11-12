import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DESK_LINK_TTL_SECONDS, deskLinkParams, deskUrl, verifyDeskLink } from "./deskLink.server";

const SHOP = "my-store.myshopify.com";
const NOW = 1_800_000_000_000;

describe("desk links", () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = "test-secret";
    process.env.SHOPIFY_APP_URL = "https://app.example.com/";
  });
  afterAll(() => {
    process.env = saved;
  });

  it("builds the URL pattern with only shop, exp and sig", () => {
    const url = new URL(deskUrl(SHOP, "123", NOW));
    expect(url.origin + url.pathname).toBe("https://app.example.com/desk/123");
    expect([...url.searchParams.keys()].sort()).toEqual(["exp", "shop", "sig"]);
    expect(Number(url.searchParams.get("exp"))).toBe(NOW / 1000 + DESK_LINK_TTL_SECONDS);
  });

  it("verifies a fresh link", () => {
    const p = deskLinkParams(SHOP, "123", NOW);
    expect(verifyDeskLink("123", p.shop, p.exp, p.sig, NOW + 60_000)).toEqual({ ok: true, shop: SHOP });
  });

  it("rejects an expired link", () => {
    const p = deskLinkParams(SHOP, "123", NOW);
    const later = NOW + (DESK_LINK_TTL_SECONDS + 1) * 1000;
    expect(verifyDeskLink("123", p.shop, p.exp, p.sig, later)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampering", () => {
    const p = deskLinkParams(SHOP, "123", NOW);
    expect(verifyDeskLink("124", p.shop, p.exp, p.sig, NOW).ok).toBe(false);
    expect(verifyDeskLink("123", "other.myshopify.com", p.exp, p.sig, NOW).ok).toBe(false);
    expect(verifyDeskLink("123", p.shop, String(Number(p.exp) + 600), p.sig, NOW).ok).toBe(false);
    expect(verifyDeskLink("123", p.shop, p.exp, "00", NOW).ok).toBe(false);
    expect(verifyDeskLink("123", "evil.com", p.exp, p.sig, NOW).ok).toBe(false);
    expect(verifyDeskLink("123", null, null, null, NOW).ok).toBe(false);
  });
});
