import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, short-lived links to the standalone Ship Desk page:
 *
 *   <SHOPIFY_APP_URL>/desk/<orderId>?shop=<shop>.myshopify.com&exp=<unix seconds>&sig=<hex>
 *
 *   sig = HMAC-SHA256(SHOPIFY_API_SECRET, "<shop>|<orderId>|<exp>")
 *
 * Only the numeric order id and the shop domain are in the URL — never
 * customer data. Links expire after 30 minutes; staff reopen from Shopify.
 */

export const DESK_LINK_TTL_SECONDS = 30 * 60;

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const ORDER_RE = /^\d+$/;

function secret(): string {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("SHOPIFY_API_SECRET is not set");
  return s;
}

function sign(shop: string, orderId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${shop}|${orderId}|${exp}`).digest("hex");
}

export function deskLinkParams(shop: string, orderId: string, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + DESK_LINK_TTL_SECONDS;
  return { shop, exp: String(exp), sig: sign(shop, orderId, exp) };
}

/** Absolute URL when SHOPIFY_APP_URL is known (always in dev/prod), else a path. */
export function deskUrl(shop: string, orderId: string, nowMs = Date.now()): string {
  const base = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/+$/, "");
  const q = new URLSearchParams(deskLinkParams(shop, orderId, nowMs));
  return `${base}/desk/${orderId}?${q}`;
}

export type DeskLinkCheck = { ok: true; shop: string } | { ok: false; reason: "invalid" | "expired" };

export function verifyDeskLink(
  orderId: string,
  shop: string | null,
  exp: string | null,
  sig: string | null,
  nowMs = Date.now(),
): DeskLinkCheck {
  if (!shop || !exp || !sig || !SHOP_RE.test(shop) || !ORDER_RE.test(orderId)) {
    return { ok: false, reason: "invalid" };
  }
  const expNum = Number(exp);
  if (!Number.isInteger(expNum)) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(shop, orderId, expNum), "hex");
  const given = Buffer.from(sig, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }
  if (expNum * 1000 < nowMs) return { ok: false, reason: "expired" };
  return { ok: true, shop };
}

/** Shopify admin URL for the order (the "Back to Shopify order" link). */
export function shopifyOrderAdminUrl(shop: string, orderId: string): string {
  const handle = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${handle}/orders/${orderId}`;
}
