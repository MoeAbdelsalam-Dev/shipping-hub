import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

/**
 * Order page → More actions → "Ship with Ship Desk".
 * Talks to our backend at /api/ship/:id (app/routes/api.ship.$id.tsx); Shopify
 * adds the session token to relative fetches from admin extensions. All rules
 * (GTA, PO Box, field mapping, carrier status) are computed on the server, so
 * this modal and the full page (/app/ship/:id) always agree.
 */

export default async () => {
  render(<Extension />, document.body);
};

// ---- response shapes (mirror app/lib/*; kept local so this bundle has no server code)
type AddressType = "residential" | "commercial";
type Verdict = AddressType | "unsure";
interface Box {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  presetName?: string;
}
interface Preset extends Box {
  name: string;
}
interface Classification {
  verdict: Verdict;
  confidence: number;
  reason: string;
  evidence: { title: string; url: string; snippet: string }[];
}
interface Quote {
  id: string;
  serviceName: string;
  totalCad: number;
  transitDays?: number;
  sample?: boolean;
}
interface MappedFields {
  name: string;
  attention: string | null;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  provinceCode: string;
  postalCode: string;
  phone: string | null;
  email: string | null;
  reference: string | null;
  residential: boolean | null;
  signature: string | null;
}
interface CarrierRow {
  carrierId: string;
  carrierName: string;
  status: "connected" | "not-connected" | "unavailable" | "error";
  needs: string[];
  setupWhere: string;
  message: string | null;
  usual: boolean;
  fields: MappedFields | null;
  poBoxNote: string | null;
  quotes: Quote[];
}
interface CourierHistory {
  previousOrders: number;
  usual: { courier: string; count: number } | null;
  last: { courier: string; date: string; orderName: string } | null;
  guest: boolean;
}
interface Shipment {
  numericId: string;
  otUrl: string | null;
  presets: Preset[];
  classification: Classification | null;
  classifierNeeds: string[];
  history: CourierHistory | null;
  poBox: { isPoBox: boolean; poBoxOnly: boolean };
  rows: CarrierRow[];
  draft: { addressType: AddressType | null; signatureRequired: boolean; boxes: Box[] } | null;
  order: {
    name: string;
    email: string | null;
    zone: "GTA" | "Non-GTA";
    shipTo: {
      name: string;
      company?: string | null;
      address1: string;
      address2?: string | null;
      city: string;
      provinceCode: string;
      postalCode: string;
      phone?: string | null;
    };
  };
}
interface ShipResponse {
  addressType: AddressType | null;
  rows: CarrierRow[] | null;
  quoted: boolean;
  errors: string[];
  classification: Classification | null;
}

const LABEL: Record<Verdict, string> = {
  residential: "Residential",
  commercial: "Commercial",
  unsure: "Unsure",
};
/** Box editor columns: #, L, W, H, kg, Remove. */
const BOX_COLUMNS = "28px 1fr 1fr 1fr 1fr 64px";
/** Above this many boxes the modal gets cramped: suggest the full page. */
const MODAL_BOX_LIMIT = 6;
const MAX_BOXES = 99;

function orderIdFromData(): string | null {
  const gid = shopify.data.selected[0]?.id ?? "";
  return gid.split("/").pop() || null;
}

async function api<T>(id: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/ship/${id}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Ship Desk returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

const inputValue = (e: Event) => (e.currentTarget as HTMLInputElement).value;
const checkedValue = (e: Event) => Boolean((e.currentTarget as HTMLInputElement).checked);
const validBox = (b: Box) =>
  [b.lengthCm, b.widthCm, b.heightCm, b.weightKg].every((n) => Number.isFinite(n) && n > 0);

function historyLine(h: CourierHistory | null): string {
  if (!h) return "Courier history unavailable.";
  if (h.guest) return "Guest checkout — no customer history.";
  if (h.previousOrders === 0) return "First-time customer";
  const n = h.previousOrders;
  return `${n} previous order${n === 1 ? "" : "s"} · Usually ships with: ${
    h.usual ? `${h.usual.courier} (${h.usual.count} of ${n})` : "Unknown"
  }`;
}

const TEST_BANNER = (
  <s-banner tone="warning" heading="TEST MODE — read-only">
    Nothing is shipped, booked, or changed.
  </s-banner>
);

const FIELD_LABELS: [keyof MappedFields, string][] = [
  ["name", "Name"],
  ["attention", "Attention"],
  ["company", "Company"],
  ["address1", "Address 1"],
  ["address2", "Address 2"],
  ["city", "City"],
  ["postalCode", "Postal code"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["reference", "Reference"],
  ["signature", "Signature"],
];
// Mirrors bestQuotes() in app/lib/carrierRows.ts (kept local: no server code here).
interface Best {
  carrierName: string;
  quote: Quote;
}
function bestQuotes(rows: CarrierRow[]): { cheapest: Best | null; fastest: Best | null } {
  const all = rows.flatMap((r) => r.quotes.map((quote) => ({ carrierName: r.carrierName, quote })));
  if (all.length === 0) return { cheapest: null, fastest: null };
  const cheapest = all.reduce((a, b) => (b.quote.totalCad < a.quote.totalCad ? b : a));
  const timed = all.filter((x) => x.quote.transitDays !== undefined);
  const fastest = timed.length
    ? timed.reduce((a, b) => {
        const da = a.quote.transitDays!;
        const db = b.quote.transitDays!;
        return db < da || (db === da && b.quote.totalCad < a.quote.totalCad) ? b : a;
      })
    : null;
  return { cheapest, fastest };
}
function bestText({ carrierName, quote: q }: Best): string {
  const days = q.transitDays === undefined ? "—" : String(q.transitDays);
  const plural = q.transitDays === 1 ? "" : "s";
  const price = "$" + q.totalCad.toFixed(2);
  return `${carrierName} · ${q.serviceName} · ${days} day${plural} · ${price}${q.sample ? " (sample)" : ""}`;
}

const show = (v: MappedFields[keyof MappedFields]) =>
  v === null || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);

function Extension() {
  const id = orderIdFromData();
  const [data, setData] = useState<Shipment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addressType, setAddressType] = useState<AddressType | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [dup, setDup] = useState("1");
  const [signature, setSignature] = useState(false);
  const [sample, setSample] = useState(false);
  const [classification, setClassification] = useState<Classification | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<CarrierRow[]>([]);
  const [quoted, setQuoted] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [showFields, setShowFields] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoadError("No order selected.");
      return;
    }
    api<Shipment>(id)
      .then((d) => {
        setData(d);
        setAddressType(d.draft?.addressType ?? null);
        setBoxes(d.draft?.boxes ?? []);
        setSignature(d.draft?.signatureRequired ?? false);
        setClassification(d.classification);
        setRows(d.rows);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (loadError) {
    return (
      <s-admin-action heading="Ship Desk">
        {TEST_BANNER}
        <s-banner tone="critical">{loadError}</s-banner>
        <s-button slot="secondary-actions" onClick={() => shopify.close()}>
          Close
        </s-button>
      </s-admin-action>
    );
  }
  if (!data || !id) {
    return <s-admin-action heading="Ship Desk" loading />;
  }

  const a = data.order.shipTo;
  const isGta = data.order.zone === "GTA";
  const route = !addressType
    ? "needs-address-type"
    : isGta && addressType === "residential"
      ? "print-in-ot"
      : "quotes";
  const q = [a.address1, a.address2, a.city, a.provinceCode, a.postalCode]
    .filter(Boolean)
    .join(", ");
  const fullScreen = `app:app/ship/${data.numericId}`;
  const boxesValid = boxes.length > 0 && boxes.every(validBox);

  const post = async (body: Record<string, unknown>) => {
    setErrors([]);
    setSaved(false);
    try {
      return await api<ShipResponse>(id, body);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      return null;
    }
  };

  const check = async (intent: "classify" | "reclassify") => {
    setChecking(true);
    const r = await post({ intent });
    setChecking(false);
    if (r?.classification) setClassification(r.classification);
    if (r?.errors.length) setErrors(r.errors);
  };

  const confirm = async (t: AddressType) => {
    setAddressType(t);
    setQuoted(false);
    const r = await post({ intent: "confirm", addressType: t }); // boxes left as saved
    if (r?.rows) setRows(r.rows);
  };

  const save = async (
    intent: "save" | "quote",
    over: { signature?: boolean; sample?: boolean } = {},
  ) => {
    setBusy(true);
    const r = await post({
      intent,
      addressType,
      boxes,
      signatureRequired: over.signature ?? signature,
      sample: over.sample ?? sample,
    });
    setBusy(false);
    if (!r) return;
    if (r.rows) setRows(r.rows);
    setQuoted(r.quoted);
    setErrors(r.errors);
    if (intent === "save") setSaved(true);
  };

  const setField = (i: number, f: keyof Box, v: string) =>
    setBoxes((bs) =>
      bs.map((b, j) => (j === i ? { ...b, [f]: Number(v) || 0, presetName: undefined } : b)),
    );
  const duplicateLast = () => {
    const n = Math.max(1, Math.floor(Number(dup) || 1));
    setBoxes((bs) =>
      bs.length === 0
        ? bs
        : [
            ...bs,
            ...Array.from({ length: Math.min(n, MAX_BOXES - bs.length) }, () => ({
              ...bs[bs.length - 1],
            })),
          ],
    );
  };
  const totalKg = boxes.reduce((s, b) => s + (b.weightKg || 0), 0);
  const best = bestQuotes(rows);

  return (
    <s-admin-action heading={`Ship ${data.order.name}`}>
      <s-stack gap="base">
        {TEST_BANNER}

        {/* ---- ship to + zone + history */}
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={isGta ? "success" : "info"}>{data.order.zone}</s-badge>
            {data.poBox.isPoBox ? <s-badge tone="info">PO Box → CP</s-badge> : null}
            {data.poBox.poBoxOnly ? (
              <s-badge tone="warning">PO Box only — Canada Post only</s-badge>
            ) : null}
            {a.company ? <s-text type="strong">{a.company}</s-text> : null}
          </s-stack>
          <s-text>
            {a.name} · {a.address1}
            {a.address2 ? `, ${a.address2}` : ""}, {a.city} {a.provinceCode} {a.postalCode}
          </s-text>
          {a.phone ? <s-text color="subdued">Tel: {a.phone}</s-text> : null}
          {data.order.email ? <s-text color="subdued">Email: {data.order.email}</s-text> : null}
          <s-text color="subdued">
            {historyLine(data.history)}
            {data.history?.last
              ? ` · Last: ${data.history.last.courier}, ${new Date(data.history.last.date).toLocaleDateString("en-CA")}, ${data.history.last.orderName}`
              : ""}
          </s-text>
          <s-stack direction="inline" gap="small-200">
            <s-link href={`https://www.google.com/search?q=${encodeURIComponent(q)}`} target="_blank">
              Google
            </s-link>
            <s-link
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`}
              target="_blank"
            >
              Maps
            </s-link>
          </s-stack>
        </s-stack>

        {/* ---- address check (suggestion only) */}
        <s-box padding="base" border="base" borderRadius="base">
          {classification ? (
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">Address check:</s-text>
                <s-badge
                  tone={
                    classification.verdict === "unsure"
                      ? "warning"
                      : classification.verdict === "residential"
                        ? "success"
                        : "info"
                  }
                >
                  {LABEL[classification.verdict]}
                </s-badge>
                {classification.verdict !== "unsure" ? (
                  <s-text color="subdued">{Math.round(classification.confidence * 100)}%</s-text>
                ) : null}
              </s-stack>
              <s-text>{classification.reason}</s-text>
              {classification.evidence.map((e, i) => (
                <s-link key={i} href={e.url} target="_blank">
                  {e.title || e.url}
                </s-link>
              ))}
              {classification.verdict === "unsure" ? (
                <s-banner tone="warning">
                  Can&apos;t tell — contact the customer{a.phone ? ` (${a.phone})` : ""}.
                </s-banner>
              ) : addressType === classification.verdict ? (
                <s-badge tone="success">Confirmed {LABEL[classification.verdict]}</s-badge>
              ) : (
                <s-button
                  variant="primary"
                  onClick={() => confirm(classification.verdict as AddressType)}
                >
                  Confirm {LABEL[classification.verdict]}
                </s-button>
              )}
              {data.classifierNeeds.length === 0 ? (
                <s-button variant="tertiary" onClick={() => check("reclassify")} loading={checking}>
                  Check again
                </s-button>
              ) : null}
            </s-stack>
          ) : data.classifierNeeds.length > 0 ? (
            <s-text color="subdued">
              Automatic address check not connected — needs {data.classifierNeeds.join(", ")}.{" "}
              <s-link href="app:app/setup">Setup</s-link>
            </s-text>
          ) : (
            <s-button onClick={() => check("classify")} loading={checking}>
              Check address automatically
            </s-button>
          )}
        </s-box>

        {/* ---- manual choice (also a confirmation) */}
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text>Address is:</s-text>
          <s-button
            variant={addressType === "residential" ? "primary" : "secondary"}
            onClick={() => confirm("residential")}
          >
            Residential
          </s-button>
          <s-button
            variant={addressType === "commercial" ? "primary" : "secondary"}
            onClick={() => confirm("commercial")}
          >
            Commercial
          </s-button>
        </s-stack>

        {/* ---- next step */}
        {route === "needs-address-type" ? (
          <s-text color="subdued">Confirm Residential or Commercial to continue.</s-text>
        ) : null}

        {route === "print-in-ot" ? (
          <s-banner tone="info" heading="Ships with OT">
            GTA residential — no quotes, dimensions or weight needed. Print OT&apos;s labels in
            OT.
            {data.otUrl
              ? null
              : " Press Print in OT, then use OT's own action under More actions on this order."}
          </s-banner>
        ) : null}

        {route === "quotes" ? (
          <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200">
                {data.presets.map((p) => (
                  <s-button
                    key={p.name}
                    disabled={boxes.length >= MAX_BOXES}
                    onClick={() =>
                      setBoxes((bs) => [
                        ...bs,
                        {
                          lengthCm: p.lengthCm,
                          widthCm: p.widthCm,
                          heightCm: p.heightCm,
                          weightKg: p.weightKg,
                          presetName: p.name,
                        },
                      ])
                    }
                  >
                    + {p.name}
                  </s-button>
                ))}
                <s-button
                  variant="tertiary"
                  disabled={boxes.length >= MAX_BOXES}
                  onClick={() =>
                    setBoxes((bs) => [...bs, { lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0 }])
                  }
                >
                  + Custom
                </s-button>
              </s-stack>

              {boxes.length > MODAL_BOX_LIMIT ? (
                <s-banner tone="info">
                  {boxes.length} boxes — easier to edit in{" "}
                  <s-link href={fullScreen}>full screen</s-link>.
                </s-banner>
              ) : null}

              {boxes.length > 0 ? (
                // A fixed-column grid, not <s-table>: in the narrow modal the table
                // switches to a list layout and headers stop lining up with cells.
                <s-stack gap="small-100">
                  <s-grid gridTemplateColumns={BOX_COLUMNS} gap="small-200" alignItems="center">
                    {["#", "L", "W", "H", "kg", "Remove"].map((h) => (
                      <s-text key={h} type="strong">
                        {h}
                      </s-text>
                    ))}
                  </s-grid>
                  {boxes.map((b, i) => (
                    <s-grid key={i} gridTemplateColumns={BOX_COLUMNS} gap="small-200" alignItems="center">
                      <s-text>{i + 1}</s-text>
                      {(["lengthCm", "widthCm", "heightCm", "weightKg"] as const).map((f) => (
                        <s-number-field
                          key={f}
                          label={f}
                          labelAccessibilityVisibility="exclusive"
                          value={b[f] ? String(b[f]) : ""}
                          min={0}
                          step={f === "weightKg" ? 0.1 : 1}
                          onInput={(e: Event) => setField(i, f, inputValue(e))}
                        />
                      ))}
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        accessibilityLabel={`Remove box ${i + 1}`}
                        onClick={() => setBoxes((bs) => bs.filter((_, j) => j !== i))}
                      >
                        ✕
                      </s-button>
                    </s-grid>
                  ))}
                </s-stack>
              ) : (
                <s-text color="subdued">No boxes yet — add a preset.</s-text>
              )}

              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-number-field
                  label="Copies of last box"
                  labelAccessibilityVisibility="exclusive"
                  value={dup}
                  min={1}
                  max={MAX_BOXES}
                  step={1}
                  onInput={(e: Event) => setDup(inputValue(e))}
                />
                <s-button onClick={duplicateLast} disabled={boxes.length === 0}>
                  Duplicate last ×{dup || 1}
                </s-button>
                <s-text color="subdued">
                  {boxes.length} box{boxes.length === 1 ? "" : "es"} · {totalKg.toFixed(1)} kg
                </s-text>
              </s-stack>

              <s-checkbox
                label="Signature required"
                details="UPS: Adult Signature Required · Canada Post: Signature"
                checked={signature}
                onChange={(e: Event) => {
                  const v = checkedValue(e);
                  setSignature(v);
                  if (quoted) void save("quote", { signature: v });
                }}
              />
              <s-checkbox
                label="Preview with sample prices"
                checked={sample}
                onChange={(e: Event) => {
                  const v = checkedValue(e);
                  setSample(v);
                  if (quoted) void save("quote", { sample: v });
                }}
              />
          </s-stack>
        ) : null}

        {/* ---- carrier rows */}
        {route === "quotes" ? (
          <s-stack gap="small-200">
            {best.cheapest ? (
              <s-box padding="small" border="base" borderRadius="base">
                <s-stack gap="small-100">
                  <s-text>
                    <s-text type="strong">Best price: </s-text>
                    {bestText(best.cheapest)}
                  </s-text>
                  {best.fastest ? (
                    <s-text>
                      <s-text type="strong">Fastest: </s-text>
                      {bestText(best.fastest)}
                    </s-text>
                  ) : null}
                </s-stack>
              </s-box>
            ) : null}
            {rows.map((row) => (
              <s-box key={row.carrierId} padding="small" border="base" borderRadius="base">
                <s-stack gap="small-100">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text type="strong">{row.carrierName}</s-text>
                    {row.usual ? <s-badge tone="info">Usual</s-badge> : null}
                    {row.poBoxNote === "PO Box → CP" ? <s-badge>PO Box → CP</s-badge> : null}
                  </s-stack>
                  {row.status === "not-connected" ? (
                    <s-text color="subdued">
                      Not connected — needs {row.needs.join(", ")}.{" "}
                      <s-link href="app:app/setup">Setup</s-link>
                    </s-text>
                  ) : null}
                  {row.message ? <s-text color="subdued">{row.message}</s-text> : null}
                  {row.quotes.map((qt) => {
                    const tipId = `tip-${qt.id.replace(/[^a-z0-9]/gi, "-")}`;
                    return (
                      <s-stack key={qt.id} direction="inline" gap="small-200" alignItems="center">
                        <s-text>
                          {qt.serviceName}: ${qt.totalCad.toFixed(2)}
                          {qt.transitDays ? ` · ${qt.transitDays} d` : ""}
                        </s-text>
                        {best.cheapest?.quote.id === qt.id ? (
                          <s-badge tone="success">Cheapest</s-badge>
                        ) : null}
                        {qt.sample ? <s-badge tone="warning">SAMPLE</s-badge> : null}
                        <s-button disabled interestFor={tipId}>
                          Print labels
                        </s-button>
                        <s-tooltip id={tipId}>
                          {row.status === "connected"
                            ? "Booking is off in this read-only build"
                            : `Available once ${row.carrierName} is connected`}
                        </s-tooltip>
                        {row.fields && boxesValid ? (
                          <s-link href={`${fullScreen}?preview=${row.carrierId}`}>
                            Preview sample label
                          </s-link>
                        ) : null}
                      </s-stack>
                    );
                  })}
                </s-stack>
              </s-box>
            ))}

            <s-button variant="tertiary" onClick={() => setShowFields((v) => !v)}>
              {showFields ? "Hide" : "Show"} what each courier will receive
            </s-button>
            {showFields ? (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Field</s-table-header>
                  {rows.map((r) => (
                    <s-table-header key={r.carrierId}>{r.carrierName}</s-table-header>
                  ))}
                </s-table-header-row>
                <s-table-body>
                  {FIELD_LABELS.map(([key, label]) => (
                    <s-table-row key={key}>
                      <s-table-cell>{label}</s-table-cell>
                      {rows.map((r) => (
                        <s-table-cell key={r.carrierId}>
                          {r.fields ? show(r.fields[key]) : key === "name" ? r.message ?? "—" : "—"}
                        </s-table-cell>
                      ))}
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            ) : null}
          </s-stack>
        ) : null}

        {saved ? <s-banner tone="success">Shipment saved.</s-banner> : null}
        {errors.length > 0 ? (
          <s-banner tone="critical">
            {errors.map((e) => (
              <s-text key={e}>{e}</s-text>
            ))}
          </s-banner>
        ) : null}
      </s-stack>

      {/* ---- footer actions */}
      {route === "print-in-ot" ? (
        data.otUrl ? (
          <s-button slot="primary-action" href={data.otUrl} target="_blank">
            Print in OT
          </s-button>
        ) : (
          <s-button slot="primary-action" onClick={() => shopify.close()}>
            Print in OT
          </s-button>
        )
      ) : route === "quotes" ? (
        <s-button slot="primary-action" onClick={() => save("quote")} loading={busy}>
          Get quotes
        </s-button>
      ) : null}
      <s-button slot="secondary-actions" href={fullScreen}>
        Open full screen
      </s-button>
      {route === "quotes" ? (
        <s-button slot="secondary-actions" onClick={() => save("save")}>
          Save
        </s-button>
      ) : null}
    </s-admin-action>
  );
}
