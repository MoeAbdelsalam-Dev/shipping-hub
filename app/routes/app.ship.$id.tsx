import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { AddressCheckPanel } from "../components/AddressCheckPanel";
import { CarrierQuotes, CourierFieldsPanel } from "../components/CarrierQuotes";
import { TestModeBanner } from "../components/TestModeBanner";
import { PackageEntry } from "../components/PackageEntry";
import type { CarrierRow } from "../lib/carrierRows";
import type { Classification } from "../lib/classifier/types";
import { historySummary } from "../lib/courier";
import { shipRoute } from "../lib/rules";
import {
  expandGroups,
  groupBoxes,
  packageCount,
  validatePackages,
  type PackageGroup,
} from "../lib/packages";
import { openSampleLabels } from "../lib/sampleLabel";
import {
  handleShipment,
  loadShipment,
  parseShipRequest,
} from "../lib/shipping.server";
import type { AddressType, Quote } from "../../carriers";
import packagesCss from "../styles/packages.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: packagesCss }];

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

/**
 * React 18 does not wire onChange on custom elements, so listen for the
 * checkbox's change event directly.
 */
// Callback ref: the checkbox may mount later (e.g. after Residential/Commercial is
// chosen), so the listener is attached whenever the element appears.
function useCheckbox(onChange: (checked: boolean) => void) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElementTagNameMap["s-checkbox"] | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const h = () => cb.current(Boolean(el.checked));
    el.addEventListener("change", h);
    cleanup.current = () => el.removeEventListener("change", h);
  }, []);
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
  const [groups, setGroups] = useState<PackageGroup[]>(() => groupBoxes(draft?.boxes ?? []));
  const [pkgErrors, setPkgErrors] = useState<string[]>([]);
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

  const boxesValid = groups.length > 0 && validatePackages(groups).length === 0;

  const submit = useCallback(
    (intent: "save" | "quote", over: { sample?: boolean; signature?: boolean } = {}) => {
      if (intent === "quote") {
        // Every package needs L, W, H and weight before quoting.
        const errs = validatePackages(groups);
        setPkgErrors(errs);
        if (errs.length) return;
      }
      lastIntent.current = intent;
      fetcher.submit(
        {
          intent,
          addressType: addressType ?? "",
          signatureRequired: String(over.signature ?? signature),
          sample: String(over.sample ?? sample),
          boxes: JSON.stringify(expandGroups(groups)),
        },
        { method: "POST" },
      );
    },
    [fetcher, addressType, signature, sample, groups],
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
      boxes: expandGroups(groups),
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
                Open sample labels ({packageCount(groups)})
              </s-button>
            ) : (
              <s-text color="subdued">
                {previewRow.fields
                  ? "Add packages with dimensions and weight first."
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
          <s-section heading={`Packages (${packageCount(groups)})`}>
            <s-stack gap="base">
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
                  Add packages and press Get quotes (or Enter on the empty entry line).
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
