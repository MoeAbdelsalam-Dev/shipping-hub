import boxConfig from "../../config/boxes.json";
import { missingEnv } from "../../carriers/env";
import { getShipFrom, SHIP_FROM_KEY, type ShipFromLocation } from "./locations.server";
import type { AdminGraphql } from "./orders.server";
import { CARRIERS } from "./rules";
import { getSettings } from "./settings.server";
import { manualKey, type SetupItem, type SetupStatus } from "./setup";

/**
 * Builds the "Setup — what we need" checklist. Status is detected where we
 * can (env vars present, granted scopes, Shopify Locations, config files);
 * the rest is set by hand on the page and stored in Setting ("setup.<id>").
 * Only env var NAMES are ever returned, never values.
 */


function envItem(names: string[], optional: string[] = []) {
  const all = [...names, ...optional];
  const missing = new Set(missingEnv(all));
  const env = all.map((n) => ({ name: n, set: !missing.has(n), optional: optional.includes(n) }));
  const requiredSet = names.filter((n) => !missing.has(n)).length;
  const status: SetupStatus =
    requiredSet === names.length ? "done" : requiredSet > 0 ? "waiting" : "not-started";
  return { env, status };
}

function manualStatus(settings: Record<string, string>, id: string): SetupStatus {
  const v = settings[manualKey(id)];
  return v === "done" || v === "waiting" ? v : "not-started";
}

const fmtLocation = (l: ShipFromLocation) =>
  `${l.name}: ${[l.address1, l.address2, `${l.city} ${l.provinceCode} ${l.postalCode}`]
    .filter(Boolean)
    .join(", ")}`;

export async function buildChecklist(
  admin: AdminGraphql,
  shop: string,
  grantedScopes: string,
) {
  const [settings, shipFrom] = await Promise.all([getSettings(shop), getShipFrom(admin, shop)]);
  const scopes = grantedScopes.split(",").map((s) => s.trim()).filter(Boolean);
  const readOnly = scopes.length > 0 && scopes.every((s) => s.startsWith("read_"));

  const ups = envItem(CARRIERS.ups.requiredEnv, ["UPS_ENV"]);
  const cp = envItem(CARRIERS.canadapost.requiredEnv, ["CP_ENV"]);
  const otEnv = envItem(CARRIERS.ot.requiredEnv);
  const classifier = envItem(["BRAVE_SEARCH_API_KEY", "ANTHROPIC_API_KEY"], ["CLASSIFIER_MODEL"]);

  const items: SetupItem[] = [
    {
      id: "shopify-app",
      title: "Shopify app installed, read-only",
      status: readOnly ? "done" : scopes.length ? "waiting" : "not-started",
      auto: true,
      who: "Us",
      why: "Lets Ship Desk read orders, customers and locations. It cannot change anything in the store.",
      where: "Installed from the Shopify Dev Dashboard (shopify.app.toml scopes)",
      details: [`Granted scopes: ${scopes.join(", ") || "(none yet)"}`],
    },
    {
      id: "staff-account",
      title: "Staff account: Orders view + Customers view",
      status: manualStatus(settings, "staff-account"),
      auto: false,
      who: "Manager",
      why: "Staff who ship need to open orders and see customer details inside Ship Desk.",
      where: "Shopify admin → Settings → Users and permissions",
    },
    {
      id: "owner-approval",
      title: "Approval to install on the work store (read-only)",
      status: manualStatus(settings, "owner-approval"),
      auto: false,
      who: "Owner",
      why: "The app reads real orders and customer data; the owner signs off before we use it daily.",
      where: "Owner's OK (email or in person)",
    },
    {
      id: "ups",
      title: "UPS: Client ID, Client Secret, Account number",
      status: ups.status,
      auto: true,
      who: "Manager (UPS account holder)",
      why: "Real UPS prices and labels inside Ship Desk.",
      where: "UPS Developer Portal → app credentials → Railway variables UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_NUMBER, UPS_ENV",
      env: ups.env,
    },
    {
      id: "canadapost",
      title: "Canada Post: API username/password, Customer number, Contract number",
      status: cp.status,
      auto: true,
      who: "Manager (Canada Post business account holder)",
      why: "Real Canada Post prices and labels; PO Box orders go to Canada Post.",
      where: "Canada Post Developer Program → API keys → Railway variables CP_API_USERNAME, CP_API_PASSWORD, CP_CUSTOMER_NUMBER, CP_CONTRACT_NUMBER, CP_ENV",
      env: cp.env,
    },
    {
      id: "ot",
      title: "OT: API key — or approval for a Chrome extension",
      status: otEnv.status === "done" ? "done" : manualStatus(settings, "ot"),
      auto: otEnv.status === "done",
      who: "Manager (asks OT)",
      why: "OT has no public API we know of. If OT gives us an API key, Ship Desk talks to OT directly; if not, a small Chrome extension on the shipping PC fills OT's page for staff.",
      where: "If OT has an API → Railway variable OT_API_KEY. If not → written approval to install the extension on the shipping PC.",
      env: otEnv.env,
    },
    {
      id: "ship-from",
      title: "Ship-from address confirmed",
      status: shipFrom.confirmed ? "done" : shipFrom.location ? "waiting" : "not-started",
      auto: true,
      who: "Manager",
      why: "Every carrier needs the address parcels leave from.",
      where: "Shopify admin → Settings → Locations (confirm the right one below)",
      details: shipFrom.location
        ? [`${shipFrom.confirmed ? "Confirmed" : "Suggested"} — ${fmtLocation(shipFrom.location)}`]
        : ["No locations readable yet — the app needs read_locations (open the app once to accept it)."],
    },
    {
      id: "boxes",
      title: "Box sizes (top 5)",
      status: (boxConfig as { _placeholder?: boolean })._placeholder ? "not-started" : "done",
      auto: true,
      who: "Shipping staff",
      why: "One-click box presets with your real carton sizes and typical weights.",
      where: "config/boxes.json (we update it; then set _placeholder to false)",
      details: [
        `Now: ${boxConfig.presets.map((p) => `${p.name} ${p.lengthCm}×${p.widthCm}×${p.heightCm} cm`).join(" · ")}`,
      ],
    },
    {
      id: "address-check",
      title: "Automatic address check (optional)",
      status: classifier.status,
      auto: true,
      who: "Us",
      why: "Suggests Residential/Commercial from a web search; staff always confirm.",
      where: "Brave Search API + Anthropic Console → Railway variables BRAVE_SEARCH_API_KEY, ANTHROPIC_API_KEY",
      env: classifier.env,
    },
    {
      id: "write-permission",
      title: "Later (Release 3): permission to send tracking numbers to Shopify",
      status: "later",
      auto: true,
      who: "Owner",
      why: "So orders are marked fulfilled with tracking automatically. Not needed for the read-only test.",
      where: "Add write fulfillment scopes to shopify.app.toml, then approve in Shopify",
    },
  ];

  return { items, locations: shipFrom.locations, shipFromId: settings[SHIP_FROM_KEY] ?? null };
}
