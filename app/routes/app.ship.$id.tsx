import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { AddressCheckPanel } from "../components/AddressCheckPanel";
import { CarrierQuotes, CourierFieldsPanel } from "../components/CarrierQuotes";
import { TestModeBanner } from "../components/TestModeBanner";
import { MAX_BOXES, isValidBox, type BoxPreset } from "../lib/boxes";
import type { CarrierRow } from "../lib/carrierRows";
import type { Classification } from "../lib/classifier/types";
import { historySummary } from "../lib/courier";
import { shipRoute } from "../lib/rules";
import { openSampleLabels } from "../lib/sampleLabel";
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
const plainBox = (r: Row): Box => ({
  lengthCm: r.lengthCm,
  widthCm: r.widthCm,
  heightCm: r.heightCm,
  weightKg: r.weightKg,
  presetName: r.presetName,
});

/**
 * React 18 does not wire onChange on custom elements, so listen for the
 * checkbox's change event directly.
 */
function useCheckbox(onChange: (checked: boolean) => void) {
  const ref = useRef<HTMLElementTagNameMap["s-checkbox"]>(null);
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = () => cb.current(Boolean(el.checked));
    el.addEventListener("change", h);
    return () => el.removeEventListener("change", h);
  }, []);
  return ref;
}

export default function ShipOrder() {
  const data = useLoaderData<typeof loader>();
  const {
    order,
    otUrl,
    shopifyOrderUrl,
    presets,
    draft,
    history,
    shipFrom,
    poBox,
    classifierNeeds,
  } = data;
  const fetcher = useFetcher<typeof action>();
  const checkFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [params] = useSearchParams();

  const classification: Classification | null =
    checkFetcher.data?.classification ?? data.classification;

  const [addressType, setAddressType] = useState<AddressType | null>(
    draft?.addressType ?? null,
  );
  const [boxes, setBoxes] = useState<Row[]>(() => (draft?.boxes ?? []).map(toRow));
  const [dupCount, setDupCount] = useState<Record<number, string>>({});
  const [signature, setSignature] = useState<boolean>(draft?.signatureRequired ?? false);
  const [sample, setSample] = useState(false);

  const carrierRows: CarrierRow[] = fetcher.data?.rows ?? data.rows;
  const quoted = fetcher.data?.quoted ?? false;

  const a = order.shipTo;
  const isGta = order.zone === "GTA";
  const route = shipRoute(order.zone, addressType);
  const q = [a.address1, a.address2, a.city, a.provinceCode, a.postalCode]
    .filter(Boolean)
    .join(", ");
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
  const room = MAX_BOXES - boxes.length;
  const addRow = (r: Row) => room > 0 && setBoxes((rs) => [...rs, r]);
  const updateRow = (key: number, field: keyof Box, value: string) =>
    setBoxes((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, [field]: Number(value) || 0, presetName: undefined } : r,
      ),
    );
  const removeRow = (key: number) => setBoxes((rs) => rs.filter((r) => r.key !== key));
  const duplicateRow = (key: number) => {
    const n = Math.max(1, Math.floor(Number(dupCount[key] || "1")));
    setBoxes((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      if (i < 0) return rs;
      const copies = Array.from({ length: Math.min(n, MAX_BOXES - rs.length) }, () =>
        toRow(rs[i]),
      );
      return [...rs.slice(0, i + 1), ...copies, ...rs.slice(i + 1)];
    });
  };
  const totalKg = boxes.reduce((s, r) => s + (r.weightKg || 0), 0);
  const boxesValid = boxes.length > 0 && boxes.every(isValidBox);

  const submit = useCallback(
    (intent: "save" | "quote", over: { sample?: boolean; signature?: boolean } = {}) => {
      lastIntent.current = intent;
      fetcher.submit(
        {
          intent,
          addressType: addressType ?? "",
          signatureRequired: String(over.signature ?? signature),
          sample: String(over.sample ?? sample),
          boxes: JSON.stringify(boxes.map(plainBox)),
        },
        { method: "POST" },
      );
    },
    [fetcher, addressType, signature, sample, boxes],
  );

  const runCheck = (intent: "classify" | "reclassify") =>
    checkFetcher.submit({ intent }, { method: "POST" });
  const confirmType = (t: AddressType) => {
    setAddressType(t);
    lastIntent.current = "confirm";
    // No "boxes" field: the saved boxes are left as they are.
    fetcher.submit({ intent: "confirm", addressType: t }, { method: "POST" });
  };

  const signatureRef = useCheckbox((v) => {
    setSignature(v);
    if (quoted) submit("quote", { signature: v });
  });
  const sampleRef = useCheckbox((v) => {
    setSample(v);
    if (quoted) submit("quote", { sample: v });
  });

  const previewLabels = (row: CarrierRow, quote: Pick<Quote, "serviceName">) => {
    if (!row.fields) return;
    const ok = openSampleLabels({
      carrierName: row.carrierName,
      serviceName: quote.serviceName,
      orderName: order.name,
      fields: row.fields,
      shipFrom,
      boxes: boxes.map(plainBox),
    });
    if (!ok) shopify.toast.show("Allow pop-ups to preview labels", { isError: true });
  };

  // Arrived from the order modal's "Preview sample label".
  const previewRow = carrierRows.find((r) => r.carrierId === params.get("preview"));

  const errors = fetcher.data?.errors ?? [];

  return (
    <s-page heading={`Ship ${order.name}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Orders to ship
      </s-link>

      <TestModeBanner />

      {previewRow ? (
        <s-section heading={`Sample label preview — ${previewRow.carrierName}`}>
          <s-stack gap="small-200">
            {previewRow.fields && boxesValid ? (
              <s-button
                variant="primary"
                icon="print"
                onClick={() => previewLabels(previewRow, { serviceName: "Sample service" })}
              >
                Open sample labels ({boxes.length})
              </s-button>
            ) : (
              <s-text color="subdued">
                {previewRow.fields
                  ? "Add boxes with dimensions and weight first."
                  : previewRow.message}
              </s-text>
            )}
          </s-stack>
        </s-section>
      ) : null}

      {/* ---------------- Ship-to + address type */}
      <s-section heading="Ship to">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={isGta ? "success" : "info"}>{order.zone}</s-badge>
            {poBox.isPoBox ? <s-badge tone="info">PO Box → CP</s-badge> : null}
            {poBox.poBoxOnly ? (
              <s-badge tone="warning">PO Box only — Canada Post only</s-badge>
            ) : null}
            <s-text color="subdued">
              {order.fulfillmentStatus.replace(/_/g, " ").toLowerCase()}
            </s-text>
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
            {order.email ? <s-paragraph>Email: {order.email}</s-paragraph> : null}
          </s-box>

          {/* Courier history: information only, never decides res/com. */}
          <s-box padding="small" background="subdued" borderRadius="base">
            <s-stack gap="small-100">
              <s-text type="strong">
                {history ? historySummary(history) : "Courier history unavailable."}
              </s-text>
              {history?.last ? (
                <s-text color="subdued">
                  Last shipment: {history.last.courier} ·{" "}
                  {new Date(history.last.date).toLocaleDateString("en-CA")} ·{" "}
                  {history.last.orderName}
                </s-text>
              ) : null}
              <s-text color="subdued">Based on recent orders only (about 60 days).</s-text>
            </s-stack>
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
            needs={classifierNeeds}
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
              Not sure? Search the address, or contact the customer
              {a.phone ? ` (${a.phone})` : ""}.
            </s-text>
          ) : null}
        </s-stack>
      </s-section>

      {/* ---------------- GTA residential: one button */}
      {route === "print-in-ot" ? (
        <s-section heading="Ships with OT">
          <s-stack gap="base">
            <s-banner tone="info">
              GTA residential — no quotes, dimensions or weight needed. Print OT&apos;s labels in
              OT.
            </s-banner>
            <s-stack direction="inline" gap="small-200">
              {otUrl ? (
                <s-button variant="primary" icon="print" href={otUrl} target="_blank">
                  Print in OT
                </s-button>
              ) : (
                <s-button variant="primary" icon="print" href={shopifyOrderUrl}>
                  Print in OT
                </s-button>
              )}
            </s-stack>
            {!otUrl ? (
              <s-text color="subdued">
                Opens the order — use OT&apos;s own action under More actions. (A direct OT link
                can be added once we know OT&apos;s page address.)
              </s-text>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      {route === "needs-address-type" ? (
        <s-section>
          <s-text color="subdued">Confirm Residential or Commercial to continue.</s-text>
        </s-section>
      ) : null}

      {/* ---------------- Boxes + quotes */}
      {route === "quotes" ? (
        <>
          <s-section heading={`Boxes (${boxes.length})`}>
            {/* Enter in any box field = Get quotes */}
            <div
              role="presentation"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit("quote");
                }
              }}
            >
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
                  {boxes.length > 0 ? (
                    <s-button variant="tertiary" tone="critical" onClick={() => setBoxes([])}>
                      Clear all
                    </s-button>
                  ) : null}
                </s-stack>

                {boxes.length === 0 ? (
                  <s-paragraph>
                    No boxes yet. Add a preset, then use “Duplicate ×N” for multi-piece orders.
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
                      {boxes.map((r, i) => (
                        <s-table-row key={r.key}>
                          <s-table-cell>
                            {i + 1}
                            {r.presetName ? ` · ${r.presetName}` : ""}
                          </s-table-cell>
                          {(["lengthCm", "widthCm", "heightCm", "weightKg"] as const).map((f) => (
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
                          ))}
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
                  {boxes.length} box{boxes.length === 1 ? "" : "es"} · {totalKg.toFixed(1)} kg
                  total
                  {room <= 0 ? ` · maximum of ${MAX_BOXES} reached` : ""}
                </s-text>

                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-checkbox
                    ref={signatureRef}
                    label="Signature required"
                    details="UPS: Adult Signature Required · Canada Post: Signature"
                    {...(signature ? { checked: true } : {})}
                  />
                  <s-checkbox
                    ref={sampleRef}
                    label="Preview with sample prices"
                    details="Fills not-connected couriers with clearly labelled sample quotes"
                    {...(sample ? { checked: true } : {})}
                  />
                </s-stack>

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
            </div>
          </s-section>

          {errors.length > 0 ? (
            <s-section>
              <s-banner tone="critical" heading="Can't get quotes yet">
                {errors.map((e) => (
                  <s-paragraph key={e}>{e}</s-paragraph>
                ))}
              </s-banner>
            </s-section>
          ) : null}

          <s-section heading="Quotes">
            <s-stack gap="base">
              {!quoted ? (
                <s-text color="subdued">
                  Add boxes and press Get quotes (or Enter in a box field).
                </s-text>
              ) : null}
              <CarrierQuotes
                rows={carrierRows}
                quoted={quoted}
                sample={sample}
                canPreview={boxesValid}
                onPreviewLabel={previewLabels}
              />
              <CourierFieldsPanel rows={carrierRows} />
            </s-stack>
          </s-section>
        </>
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

      <s-section slot="aside" heading="Ship from">
        {shipFrom ? (
          <s-stack gap="small-100">
            <s-text type="strong">{shipFrom.name}</s-text>
            <s-text>
              {shipFrom.address1}
              {shipFrom.address2 ? `, ${shipFrom.address2}` : ""}
            </s-text>
            <s-text>
              {shipFrom.city} {shipFrom.provinceCode} {shipFrom.postalCode}
            </s-text>
            <s-link href="/app/setup">Confirm on Setup page</s-link>
          </s-stack>
        ) : (
          <s-text color="subdued">
            Not available yet — needs read_locations. <s-link href="/app/setup">Setup</s-link>
          </s-text>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
