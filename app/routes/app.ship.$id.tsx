import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { AddressCheckPanel } from "../components/AddressCheckPanel";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { MAX_BOXES, type BoxPreset } from "../lib/boxes";
import type { Classification } from "../lib/classifier/types";
import {
  handleShipment,
  loadShipment,
  parseShipRequest,
} from "../lib/shipping.server";
import type { AddressType, Box, Quote } from "../../carriers";

// ---------------------------------------------------------------- server

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return loadShipment(admin, session.shop, params.id ?? "");
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const req = parseShipRequest(await request.formData());
  return handleShipment(admin, session.shop, params.id ?? "", req);
};

// ---------------------------------------------------------------- client

interface Row extends Box {
  key: number;
}

let nextKey = 1;
const toRow = (b: Box): Row => ({ ...b, key: nextKey++ });
const fromPreset = (p: BoxPreset): Row =>
  toRow({
    lengthCm: p.lengthCm,
    widthCm: p.widthCm,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    presetName: p.name,
  });

function addressQuery(a: {
  company?: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  provinceCode: string;
  postalCode: string;
}) {
  return [a.company, a.address1, a.address2, a.city, a.provinceCode, a.postalCode]
    .filter(Boolean)
    .join(", ");
}

export default function ShipOrder() {
  const { order, otUrl, shopifyOrderUrl, presets, draft, classification: cached } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const checkFetcher = useFetcher<typeof action>();
  const classification: Classification | null =
    checkFetcher.data?.classification ?? cached;
  const shopify = useAppBridge();

  const [addressType, setAddressType] = useState<AddressType | null>(
    draft?.addressType ?? null,
  );
  const [rows, setRows] = useState<Row[]>(() =>
    (draft?.boxes ?? []).map(toRow),
  );
  const [dupCount, setDupCount] = useState<Record<number, string>>({});

  const a = order.shipTo;
  const isGta = order.zone === "GTA";
  // GTA + residential ships with OT (no API): staff print OT's label in OT.
  const viaOt = isGta && addressType === "residential";
  const q = addressQuery(a);
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

  const busy = fetcher.state !== "idle";
  const lastIntent = useRef<string>("");
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.saved) return;
    if (lastIntent.current === "save") shopify.toast.show("Shipment saved");
    if (lastIntent.current === "confirm" && fetcher.data.addressType) {
      shopify.toast.show(`Confirmed: ${fetcher.data.addressType}`);
    }
  }, [fetcher.state, fetcher.data, shopify]);

  // --- box helpers
  const room = MAX_BOXES - rows.length;
  const addRow = (r: Row) => room > 0 && setRows((rs) => [...rs, r]);
  const updateRow = (key: number, field: keyof Box, value: string) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? { ...r, [field]: Number(value) || 0, presetName: undefined }
          : r,
      ),
    );
  const removeRow = (key: number) =>
    setRows((rs) => rs.filter((r) => r.key !== key));
  const duplicateRow = (key: number) => {
    const n = Math.max(1, Math.floor(Number(dupCount[key] || "1")));
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      if (i < 0) return rs;
      const copies = Array.from(
        { length: Math.min(n, MAX_BOXES - rs.length) },
        () => toRow(rs[i]),
      );
      return [...rs.slice(0, i + 1), ...copies, ...rs.slice(i + 1)];
    });
  };

  const totalKg = rows.reduce((s, r) => s + (r.weightKg || 0), 0);

  const submit = (intent: "save" | "quote") => {
    lastIntent.current = intent;
    fetcher.submit(
      {
        intent,
        addressType: addressType ?? "",
        boxes: JSON.stringify(
          rows.map((r) => ({
            lengthCm: r.lengthCm,
            widthCm: r.widthCm,
            heightCm: r.heightCm,
            weightKg: r.weightKg,
            presetName: r.presetName,
          })),
        ),
      },
      { method: "POST" },
    );
  };

  const runCheck = (intent: "classify" | "reclassify") =>
    checkFetcher.submit({ intent }, { method: "POST" });
  const confirmType = (t: AddressType) => {
    setAddressType(t);
    lastIntent.current = "confirm";
    // No "boxes" field: the saved boxes are left as they are.
    fetcher.submit({ intent: "confirm", addressType: t }, { method: "POST" });
  };

  const quotes: Quote[] | null = fetcher.data?.quotes ?? null;
  const errors = fetcher.data?.errors ?? [];

  return (
    <s-page heading={`Ship ${order.name}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Orders to ship
      </s-link>

      {/* ---------------- Ship-to + address type */}
      <s-section heading="Ship to">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={isGta ? "success" : "info"}>{order.zone}</s-badge>
            <s-text>{order.fulfillmentStatus.replace(/_/g, " ").toLowerCase()}</s-text>
          </s-stack>
          <s-box>
            {a.company ? (
              <s-paragraph>
                <s-text type="strong">{a.company}</s-text>
              </s-paragraph>
            ) : null}
            <s-paragraph>{a.name}</s-paragraph>
            <s-paragraph>
              {a.address1}
              {a.address2 ? `, ${a.address2}` : ""}
            </s-paragraph>
            <s-paragraph>
              {a.city} {a.provinceCode} {a.postalCode} {a.countryCode}
            </s-paragraph>
            {a.phone ? <s-paragraph>Tel: {a.phone}</s-paragraph> : null}
          </s-box>

          <s-stack direction="inline" gap="small-200">
            <s-button href={googleUrl} target="_blank" icon="search">
              Search address on Google
            </s-button>
            <s-button href={mapsUrl} target="_blank" icon="location">
              Open in Google Maps
            </s-button>
          </s-stack>

          <AddressCheckPanel
            classification={classification}
            checking={checkFetcher.state !== "idle"}
            error={checkFetcher.data?.errors[0] ?? null}
            confirmed={addressType}
            phone={a.phone ?? null}
            onCheck={() => runCheck("classify")}
            onRecheck={() => runCheck("reclassify")}
            onConfirm={confirmType}
          />

          <s-heading>Residential or commercial?</s-heading>
          <s-stack direction="inline" gap="small-200">
            <s-button
              variant={addressType === "residential" ? "primary" : "secondary"}
              onClick={() => confirmType("residential")}
            >
              Residential
            </s-button>
            <s-button
              variant={addressType === "commercial" ? "primary" : "secondary"}
              onClick={() => confirmType("commercial")}
            >
              Commercial
            </s-button>
          </s-stack>
          {!addressType ? (
            <s-text color="subdued">
              {a.company
                ? `Has a company name ("${a.company}") — probably Commercial, but check Google to be sure.`
                : "Search the address on Google / Maps. If you still can't tell, contact the customer" +
                  (a.phone ? ` (${a.phone}).` : ".")}
            </s-text>
          ) : null}
        </s-stack>
      </s-section>

      {/* ---------------- GTA residential: ship with OT */}
      {viaOt ? (
        <s-section heading="Ship with OT">
          <s-stack gap="base">
            <s-banner tone="info">
              GTA residential address — this order ships with OT. No
              dimensions or weight needed here: open the order in OT and print
              OT&apos;s labels there.
            </s-banner>
            <s-stack direction="inline" gap="small-200">
              {otUrl ? (
                <s-button variant="primary" href={otUrl} target="_blank">
                  Open in OT to print labels
                </s-button>
              ) : (
                <s-button variant="primary" href={shopifyOrderUrl}>
                  Open order in Shopify (use OT action button)
                </s-button>
              )}
              <s-button onClick={() => submit("save")} {...(busy ? { loading: true } : {})}>
                Save
              </s-button>
            </s-stack>
            {!otUrl ? (
              <s-text color="subdued">
                Direct OT link not set up yet (config/ot.json → orderUrlTemplate).
              </s-text>
            ) : null}
          </s-stack>
        </s-section>
      ) : (
        /* ---------------- Boxes */
        <s-section heading={`Boxes (${rows.length})`}>
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200">
              {presets.map((p) => (
                <s-button
                  key={p.name}
                  onClick={() => addRow(fromPreset(p))}
                  {...(room <= 0 ? { disabled: true } : {})}
                >
                  + {p.name} ({p.lengthCm}×{p.widthCm}×{p.heightCm})
                </s-button>
              ))}
              <s-button
                variant="tertiary"
                onClick={() =>
                  addRow(toRow({ lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0 }))
                }
                {...(room <= 0 ? { disabled: true } : {})}
              >
                + Custom box
              </s-button>
              {rows.length > 0 ? (
                <s-button variant="tertiary" tone="critical" onClick={() => setRows([])}>
                  Clear all
                </s-button>
              ) : null}
            </s-stack>

            {rows.length === 0 ? (
              <s-paragraph>
                No boxes yet. Add a preset, then use “Duplicate ×N” for
                multi-piece orders.
              </s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>#</s-table-header>
                  <s-table-header>L (cm)</s-table-header>
                  <s-table-header>W (cm)</s-table-header>
                  <s-table-header>H (cm)</s-table-header>
                  <s-table-header>Weight (kg)</s-table-header>
                  <s-table-header>Duplicate</s-table-header>
                  <s-table-header>Remove</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {rows.map((r, i) => (
                    <s-table-row key={r.key}>
                      <s-table-cell>
                        {i + 1}
                        {r.presetName ? ` · ${r.presetName}` : ""}
                      </s-table-cell>
                      {(["lengthCm", "widthCm", "heightCm", "weightKg"] as const).map(
                        (f) => (
                          <s-table-cell key={f}>
                            <s-number-field
                              label={f}
                              labelAccessibilityVisibility="exclusive"
                              value={r[f] ? String(r[f]) : ""}
                              min={0}
                              step={f === "weightKg" ? 0.1 : 1}
                              onInput={(e) => updateRow(r.key, f, e.currentTarget.value)}
                            />
                          </s-table-cell>
                        ),
                      )}
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-number-field
                            label="Copies"
                            labelAccessibilityVisibility="exclusive"
                            prefix="×"
                            value={dupCount[r.key] ?? "1"}
                            min={1}
                            max={MAX_BOXES}
                            step={1}
                            onInput={(e) =>
                              setDupCount((d) => ({ ...d, [r.key]: e.currentTarget.value }))
                            }
                          />
                          <s-button
                            onClick={() => duplicateRow(r.key)}
                            {...(room <= 0 ? { disabled: true } : {})}
                          >
                            Duplicate
                          </s-button>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          icon="delete"
                          accessibilityLabel={`Remove box ${i + 1}`}
                          onClick={() => removeRow(r.key)}
                        />
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}

            <s-text>
              {rows.length} box{rows.length === 1 ? "" : "es"} · {totalKg.toFixed(1)} kg total
              {room <= 0 ? ` · maximum of ${MAX_BOXES} reached` : ""}
            </s-text>

            <s-stack direction="inline" gap="small-200">
              <s-button
                variant="primary"
                onClick={() => submit("quote")}
                {...(busy ? { loading: true } : {})}
              >
                Get quotes
              </s-button>
              <s-button onClick={() => submit("save")} {...(busy ? { loading: true } : {})}>
                Save
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {/* ---------------- Quotes */}
      {!viaOt && errors.length > 0 ? (
        <s-section>
          <s-banner tone="critical" heading="Can't get quotes yet">
            {errors.map((e) => (
              <s-paragraph key={e}>{e}</s-paragraph>
            ))}
          </s-banner>
        </s-section>
      ) : null}

      {!viaOt && quotes ? (
        <s-section heading="Quotes (mock — no real carriers connected yet)">
          {quotes.length === 0 ? (
            <s-paragraph>No quotes returned.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Carrier</s-table-header>
                <s-table-header>Service</s-table-header>
                <s-table-header format="numeric">Transit (days)</s-table-header>
                <s-table-header>Breakdown</s-table-header>
                <s-table-header format="currency">Total (CAD)</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {quotes.map((qt) => (
                  <s-table-row key={qt.id}>
                    <s-table-cell>{qt.carrierName}</s-table-cell>
                    <s-table-cell>{qt.serviceName}</s-table-cell>
                    <s-table-cell>{qt.transitDays ?? "—"}</s-table-cell>
                    <s-table-cell>
                      {(qt.breakdown ?? [])
                        .map((b) => `${b.label} $${b.amountCad.toFixed(2)}`)
                        .join(" · ")}
                    </s-table-cell>
                    <s-table-cell>${qt.totalCad.toFixed(2)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      ) : null}

      {/* ---------------- Contents */}
      <s-section slot="aside" heading="Items">
        <s-stack gap="small-200">
          {order.lineItems.map((li, i) => (
            <s-text key={i}>
              {li.quantity} × {li.name}
              {li.sku ? ` (${li.sku})` : ""}
            </s-text>
          ))}
          <s-text color="subdued">{order.itemCount} item(s) to ship</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
