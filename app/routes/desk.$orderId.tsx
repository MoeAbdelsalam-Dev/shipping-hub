import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { isRouteErrorResponse, useFetcher, useLoaderData, useRouteError } from "react-router";

import { unauthenticated } from "../shopify.server";
import { PackageEntry } from "../components/PackageEntry";
import { bestQuotes, type CarrierRow } from "../lib/carrierRows";
import type { Classification } from "../lib/classifier/types";
import { historySummary } from "../lib/courier";
import { shopifyOrderAdminUrl, verifyDeskLink } from "../lib/deskLink.server";
import { expandGroups, groupBoxes, validatePackages, type PackageGroup } from "../lib/packages";
import { shipRoute, type MappedFields } from "../lib/rules";
import { openSampleLabels } from "../lib/sampleLabel";
import {
  handleShipment,
  loadShipment,
  parseShipRequest,
  type ShipResponse,
} from "../lib/shipping.server";
import type { AddressType } from "../../carriers";
import deskCss from "../styles/desk.css?url";
import packagesCss from "../styles/packages.css?url";

/**
 * Standalone Ship Desk page, opened in a new browser tab from Shopify (order
 * "More actions" or the Orders-to-ship list). Not embedded, no App Bridge.
 *
 *   /desk/<orderId>?shop=<shop>.myshopify.com&exp=<unix>&sig=<hmac>
 *
 * Access = a signed 30-minute link (app/lib/deskLink.server.ts). Admin API
 * calls use the shop's offline session. Same data and rules as /app/ship/:id;
 * read-only like the rest of the test build.
 */

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: deskCss },
  { rel: "stylesheet", href: packagesCss },
];

export const meta: MetaFunction = () => [
  { title: "Ship Desk" },
  // The URL carries a signature: never send it to Google/Maps/evidence sites.
  { name: "referrer", content: "no-referrer" },
  { name: "robots", content: "noindex" },
];

export const headers: HeadersFunction = () => ({
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
});

type Gate =
  | { state: "invalid" | "expired" | "not-installed" }
  | {
      state: "ok";
      shop: string;
      exp: string;
      sig: string;
      backUrl: string;
      setupUrl: string;
    };

async function gate(orderId: string, get: (k: string) => string | null): Promise<Gate> {
  const check = verifyDeskLink(orderId, get("shop"), get("exp"), get("sig"));
  if (!check.ok) return { state: check.reason };
  const handle = check.shop.replace(/\.myshopify\.com$/, "");
  return {
    state: "ok",
    shop: check.shop,
    exp: get("exp")!,
    sig: get("sig")!,
    backUrl: shopifyOrderAdminUrl(check.shop, orderId),
    setupUrl: `https://admin.shopify.com/store/${handle}/apps/${process.env.SHOPIFY_API_KEY ?? ""}/app/setup`,
  };
}

async function offlineAdmin(shop: string) {
  try {
    return (await unauthenticated.admin(shop)).admin;
  } catch {
    return null;
  }
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const orderId = params.orderId ?? "";
  const g = await gate(orderId, (k) => url.searchParams.get(k));
  if (g.state !== "ok") return { gate: g, data: null };
  const admin = await offlineAdmin(g.shop);
  if (!admin) return { gate: { state: "not-installed" } as Gate, data: null };
  const data = await loadShipment(admin, g.shop, orderId);
  return { gate: g, data };
};

const EXPIRED_MSG = "Link expired — reopen from Shopify.";

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ShipResponse> => {
  const form = await request.formData();
  const orderId = params.orderId ?? "";
  const g = await gate(orderId, (k) => {
    const v = form.get(k);
    return typeof v === "string" ? v : null;
  });
  const req = parseShipRequest(form);
  const refused = (msg: string): ShipResponse => ({
    intent: req.intent,
    saved: false,
    addressType: req.addressType,
    rows: null,
    quoted: false,
    errors: [msg],
    classification: null,
  });
  if (g.state !== "ok") return refused(EXPIRED_MSG);
  const admin = await offlineAdmin(g.shop);
  if (!admin) return refused("Ship Desk is not installed on this store.");
  return handleShipment(admin, g.shop, orderId, req);
};

// ------------------------------------------------------------------ UI

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="desk-message">
      <div className="desk-logo">Ship Desk</div>
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <Message
      title={notFound ? "Order not found" : "Something went wrong"}
      body={notFound ? "This order no longer exists or is not readable." : "Close this tab and reopen Ship Desk from the Shopify order."}
    />
  );
}

const FIELD_LABELS: [keyof MappedFields, string][] = [
  ["name", "Name"],
  ["attention", "Attention"],
  ["company", "Company"],
  ["address1", "Address 1"],
  ["address2", "Address 2"],
  ["city", "City"],
  ["provinceCode", "Province"],
  ["postalCode", "Postal code"],
  ["phone", "Phone"],
  ["email", "Email (tracking notices)"],
  ["reference", "Reference"],
  ["residential", "Residential"],
  ["signature", "Signature"],
];
const show = (v: MappedFields[keyof MappedFields]) =>
  v === null || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
const money = (n: number) => `$${n.toFixed(2)}`;
const days = (d?: number) => (d === undefined ? "—" : `${d} day${d === 1 ? "" : "s"}`);

const VERDICT = { residential: "Residential", commercial: "Commercial", unsure: "Unsure" };

export default function Desk() {
  const { gate: g, data } = useLoaderData<typeof loader>();
  if (g.state === "expired" || g.state === "invalid") {
    return <Message title="Link expired — reopen from Shopify" body="For security, Ship Desk links work for 30 minutes. Open the order in Shopify and choose More actions → Ship with Ship Desk again." />;
  }
  if (g.state === "not-installed" || !data) {
    return <Message title="Ship Desk is not installed" body="Open Ship Desk once from Shopify admin, then try again." />;
  }
  return <DeskPage gate={g} data={data} />;
}

type OkGate = Extract<Gate, { state: "ok" }>;
type Data = NonNullable<Awaited<ReturnType<typeof loader>>["data"]>;

function DeskPage({ gate: g, data }: { gate: OkGate; data: Data }) {
  const { order, otUrl, presets, history, shipFrom, poBox, classifierNeeds, draft } = data;
  const fetcher = useFetcher<typeof action>();
  const checkFetcher = useFetcher<typeof action>();

  const [addressType, setAddressType] = useState<AddressType | null>(draft?.addressType ?? null);
  const [groups, setGroups] = useState<PackageGroup[]>(() => groupBoxes(draft?.boxes ?? []));
  const [signature, setSignature] = useState(draft?.signatureRequired ?? false);
  const [sample, setSample] = useState(false);
  const [pkgErrors, setPkgErrors] = useState<string[]>([]);
  const [showFields, setShowFields] = useState(true);

  const rows: CarrierRow[] = fetcher.data?.rows ?? data.rows;
  const quoted = fetcher.data?.quoted ?? false;
  const serverErrors = fetcher.data?.errors ?? [];
  const classification: Classification | null = checkFetcher.data?.classification ?? data.classification;
  const busy = fetcher.state !== "idle";

  const a = order.shipTo;
  const route = shipRoute(order.zone, addressType);
  const q = [a.address1, a.address2, a.city, a.provinceCode, a.postalCode].filter(Boolean).join(", ");
  const tokenFields = { shop: g.shop, exp: g.exp, sig: g.sig };
  const expiresAt = new Date(Number(g.exp) * 1000);

  const post = (fields: Record<string, string>) =>
    fetcher.submit({ ...tokenFields, ...fields }, { method: "POST" });

  const submit = (intent: "save" | "quote", over: { signature?: boolean; sample?: boolean } = {}) => {
    if (intent === "quote") {
      const errs = validatePackages(groups);
      setPkgErrors(errs);
      if (errs.length) return;
    }
    post({
      intent,
      addressType: addressType ?? "",
      signatureRequired: String(over.signature ?? signature),
      sample: String(over.sample ?? sample),
      boxes: JSON.stringify(expandGroups(groups)),
    });
  };

  const confirmType = (t: AddressType) => {
    setAddressType(t);
    post({ intent: "confirm", addressType: t });
  };

  const check = (intent: "classify" | "reclassify") =>
    checkFetcher.submit({ ...tokenFields, intent }, { method: "POST" });

  const { cheapest, fastest } = bestQuotes(rows);
  const boxesValid = groups.length > 0 && validatePackages(groups).length === 0;

  const preview = (row: CarrierRow, serviceName: string) => {
    if (!row.fields) return;
    if (
      !openSampleLabels({
        carrierName: row.carrierName,
        serviceName,
        orderName: order.name,
        fields: row.fields,
        shipFrom,
        boxes: expandGroups(groups),
      })
    ) {
      window.alert("Allow pop-ups for this site to preview labels.");
    }
  };

  return (
    <div className="desk">
      <div className="desk-test">TEST MODE — read-only. Nothing is shipped, booked, or changed.</div>

      {/* ------------------------------------------------ header */}
      <header className="desk-header">
        <div className="desk-header-row">
          <div className="desk-logo">Ship Desk</div>
          <div className="desk-order">{order.name}</div>
          <div className="desk-who">
            <strong>{a.company || a.name}</strong>
            {a.company ? <span className="desk-sub"> · {a.name}</span> : null}
            <span className="desk-sub"> · {a.city} {a.provinceCode}</span>
          </div>
          <span className={`desk-badge ${order.zone === "GTA" ? "is-green" : "is-blue"}`}>{order.zone}</span>
          {poBox.isPoBox ? <span className="desk-badge is-blue">PO Box → CP</span> : null}
          {poBox.poBoxOnly ? <span className="desk-badge is-amber">PO Box only — Canada Post only</span> : null}
          <a className="desk-back" href={g.backUrl}>
            ← Back to Shopify order
          </a>
        </div>

        <div className="desk-header-row">
          <div className="desk-seg" role="group" aria-label="Residential or commercial">
            {(["residential", "commercial"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={addressType === t ? "is-on" : ""}
                onClick={() => confirmType(t)}
              >
                {VERDICT[t]}
              </button>
            ))}
          </div>
          <label className="desk-check">
            <input
              type="checkbox"
              checked={signature}
              onChange={(e) => {
                setSignature(e.target.checked);
                if (quoted) submit("quote", { signature: e.target.checked });
              }}
            />
            Signature required
          </label>
          <label className="desk-check desk-toggle">
            <input
              type="checkbox"
              checked={sample}
              onChange={(e) => {
                setSample(e.target.checked);
                if (quoted) submit("quote", { sample: e.target.checked });
              }}
            />
            Preview with sample prices
          </label>
          <span className="desk-sub desk-right">
            Link valid until {expiresAt.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        <div className="desk-header-row desk-info">
          <span>
            {a.address1}
            {a.address2 ? `, ${a.address2}` : ""}, {a.city} {a.provinceCode} {a.postalCode}
            {a.phone ? ` · Tel ${a.phone}` : ""}
            {order.email ? ` · ${order.email}` : ""}
          </span>
          <a href={`https://www.google.com/search?q=${encodeURIComponent(q)}`} target="_blank" rel="noreferrer">
            Google
          </a>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`}
            target="_blank"
            rel="noreferrer"
          >
            Maps
          </a>
          <span className="desk-sub">
            {history ? historySummary(history) : "Courier history unavailable."}
            {history?.last
              ? ` · Last: ${history.last.courier}, ${new Date(history.last.date).toLocaleDateString("en-CA")}, ${history.last.orderName}`
              : ""}
          </span>
        </div>

        <div className="desk-header-row desk-info">
          {classification ? (
            <>
              <span>
                Address check: <strong>{VERDICT[classification.verdict]}</strong>
                {classification.verdict !== "unsure"
                  ? ` (${Math.round(classification.confidence * 100)}%)`
                  : ""}{" "}
                — {classification.reason}
              </span>
              {classification.evidence.map((e, i) => (
                <a key={i} href={e.url} target="_blank" rel="noreferrer">
                  {e.title || `source ${i + 1}`}
                </a>
              ))}
              {classification.verdict === "unsure" ? (
                <span className="desk-warn">Contact the customer{a.phone ? ` (${a.phone})` : ""}.</span>
              ) : addressType !== classification.verdict ? (
                <button
                  type="button"
                  className="desk-btn"
                  onClick={() => confirmType(classification.verdict as AddressType)}
                >
                  Confirm {VERDICT[classification.verdict]}
                </button>
              ) : null}
            </>
          ) : classifierNeeds.length > 0 ? (
            <span className="desk-sub">
              Automatic address check not connected — needs {classifierNeeds.join(", ")}.{" "}
              <a href={g.setupUrl} target="_blank" rel="noreferrer">
                Setup
              </a>
            </span>
          ) : (
            <button
              type="button"
              className="desk-btn"
              disabled={checkFetcher.state !== "idle"}
              onClick={() => check("classify")}
            >
              {checkFetcher.state !== "idle" ? "Checking…" : "Check address automatically"}
            </button>
          )}
          {checkFetcher.data?.errors[0] ? <span className="desk-warn">{checkFetcher.data.errors[0]}</span> : null}
        </div>
      </header>

      {/* ------------------------------------------------ body */}
      {route === "print-in-ot" ? (
        <main className="desk-main is-single">
          <section className="desk-ot">
            <h2>Ships with OT</h2>
            <p>GTA residential — no quotes, dimensions or weight needed. Print OT&apos;s labels in OT.</p>
            {otUrl ? (
              <a className="desk-big" href={otUrl} target="_blank" rel="noreferrer">
                Print in OT
              </a>
            ) : (
              <>
                <a className="desk-big" href={g.backUrl}>
                  Print in OT
                </a>
                <p className="desk-sub">
                  Opens the order in Shopify — use OT&apos;s own action under More actions. (A direct OT
                  link can be added once we know OT&apos;s page address.)
                </p>
              </>
            )}
          </section>
        </main>
      ) : (
        <main className="desk-main">
          <section className="desk-card desk-left">
            <h2>Packages</h2>
            <PackageEntry
              groups={groups}
              onChange={(next) => {
                setGroups(next);
                setPkgErrors([]);
              }}
              presets={presets}
              errors={pkgErrors}
              onEnterEmpty={() => submit("quote")}
            />
            <button
              type="button"
              className="desk-quote"
              disabled={busy || !addressType}
              onClick={() => submit("quote")}
            >
              {busy ? "Getting quotes…" : "Get quotes"}
            </button>
            {!addressType ? (
              <div className="desk-sub">Choose Residential or Commercial (top) first.</div>
            ) : null}
            <button type="button" className="desk-btn" disabled={busy} onClick={() => submit("save")}>
              Save packages
            </button>
            {fetcher.data?.saved && fetcher.data.intent === "save" && !busy ? (
              <div className="desk-ok">Saved.</div>
            ) : null}
            {serverErrors.length > 0 ? (
              <ul className="pk-errors">
                {serverErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="desk-right">
            <div className="desk-best">
              <span className="desk-best-title">BEST PRICE</span>
              {cheapest ? (
                <>
                  <span>
                    ★ <strong>{cheapest.carrierName}</strong> · {cheapest.quote.serviceName} ·{" "}
                    {days(cheapest.quote.transitDays)} ·{" "}
                    <span className="desk-price">{money(cheapest.quote.totalCad)}</span>
                    {cheapest.quote.sample ? <span className="desk-badge is-amber">SAMPLE</span> : null}
                  </span>
                  {fastest ? (
                    <span className="desk-sub">
                      Fastest: <strong>{fastest.carrierName}</strong> · {fastest.quote.serviceName} ·{" "}
                      {days(fastest.quote.transitDays)} · {money(fastest.quote.totalCad)}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="desk-sub">
                  {quoted
                    ? "No prices yet — connect couriers or turn on “Preview with sample prices”."
                    : "Enter packages and press Get quotes."}
                </span>
              )}
            </div>

            <div className="desk-couriers">
              {rows.map((row) => (
                <div key={row.carrierId} className="desk-courier">
                  <div className="desk-courier-head">
                    <h3>{row.carrierName}</h3>
                    {row.usual ? <span className="desk-badge is-blue">Usual</span> : null}
                    <span
                      className={`desk-pill ${
                        row.status === "connected"
                          ? "is-green"
                          : row.status === "unavailable"
                            ? "is-amber"
                            : row.status === "error"
                              ? "is-red"
                              : "is-grey"
                      }`}
                    >
                      {row.status === "connected"
                        ? "Connected"
                        : row.status === "unavailable"
                          ? "Not available"
                          : row.status === "error"
                            ? "Problem"
                            : "Not connected"}
                    </span>
                  </div>
                  {row.poBoxNote ? <div className="desk-sub">{row.poBoxNote}</div> : null}
                  {row.status === "not-connected" ? (
                    <div className="desk-needs">
                      Needs {row.needs.join(", ")}.{" "}
                      <a href={g.setupUrl} target="_blank" rel="noreferrer">
                        Setup
                      </a>
                    </div>
                  ) : null}
                  {row.message ? <div className="desk-needs">{row.message}</div> : null}

                  {row.quotes.length === 0 && row.status !== "unavailable" ? (
                    <div className="desk-sub desk-empty">No prices yet.</div>
                  ) : null}
                  {row.quotes.map((qt) => {
                    const isCheapest = cheapest?.quote.id === qt.id;
                    return (
                      <div key={qt.id} className={`desk-service${isCheapest ? " is-cheapest" : ""}`}>
                        <div className="desk-service-top">
                          <span className="desk-service-name">
                            {isCheapest ? "★ " : ""}
                            {qt.serviceName}
                          </span>
                          {qt.sample ? <span className="desk-badge is-amber">SAMPLE</span> : null}
                        </div>
                        <div className="desk-service-mid">
                          <span className="desk-price">{money(qt.totalCad)}</span>
                          <span className="desk-sub">{days(qt.transitDays)}</span>
                        </div>
                        <div className="desk-service-actions">
                          <button
                            type="button"
                            className="desk-btn"
                            disabled
                            title={
                              row.status === "connected"
                                ? "Booking is off in this read-only build"
                                : `Available once ${row.carrierName} is connected`
                            }
                          >
                            Print labels
                          </button>
                          {row.fields && boxesValid ? (
                            <button
                              type="button"
                              className="desk-btn desk-link"
                              onClick={() => preview(row, qt.serviceName)}
                            >
                              Preview sample label
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </main>
      )}

      {/* ------------------------------------------------ what each courier receives */}
      <section className="desk-card desk-fields">
        <button type="button" className="desk-fields-toggle" onClick={() => setShowFields((v) => !v)}>
          {showFields ? "▾" : "▸"} What each courier receives
        </button>
        {showFields ? (
          <table>
            <thead>
              <tr>
                <th>Field</th>
                {rows.map((r) => (
                  <th key={r.carrierId}>{r.carrierName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELD_LABELS.map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  {rows.map((r) => (
                    <td key={r.carrierId}>
                      {r.fields ? show(r.fields[key]) : key === "name" ? (r.message ?? "—") : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <div className="desk-sub">
          Ship from:{" "}
          {shipFrom
            ? `${shipFrom.name} — ${shipFrom.address1}, ${shipFrom.city} ${shipFrom.provinceCode} ${shipFrom.postalCode}`
            : "not confirmed yet (Setup)"}
        </div>
      </section>
    </div>
  );
}
