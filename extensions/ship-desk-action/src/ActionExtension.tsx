import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

/**
 * Order page → More actions → "Ship with Ship Desk".
 * Talks to our backend at /api/ship/:id (app/routes/api.ship.$id.tsx); Shopify
 * adds the session token to relative fetches from admin extensions.
 * The full-screen page (/app/ship/:id) has the same features with more room.
 */

export default async () => {
  render(<Extension />, document.body);
};

// ---- response shapes (mirror app/lib/shipping.server.ts; kept local so this
// bundle doesn't pull in server code)
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
  source: "live" | "mock";
  confirmedType: AddressType | null;
}
interface Quote {
  id: string;
  carrierName: string;
  serviceName: string;
  totalCad: number;
  transitDays?: number;
}
interface CourierHistory {
  previousOrders: number;
  usual: { courier: string; count: number } | null;
  last: { courier: string; date: string; orderName: string } | null;
  guest: boolean;
}
interface Shipment {
  numericId: string;
  history: CourierHistory | null;
  otUrl: string | null;
  presets: Preset[];
  classification: Classification | null;
  draft: { addressType: AddressType | null; boxes: Box[] } | null;
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
      countryCode: string;
      phone?: string | null;
    };
  };
}
interface ShipResponse {
  addressType: AddressType | null;
  quotes: Quote[] | null;
  errors: string[];
  classification: Classification | null;
}

const LABEL: Record<Verdict, string> = {
  residential: "Residential",
  commercial: "Commercial",
  unsure: "Unsure",
};
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

// Mirrors app/lib/courier.ts (kept local: no server code in this bundle).
const courierKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
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

const inputValue = (e: Event) => (e.currentTarget as HTMLInputElement).value;

function Extension() {
  const id = orderIdFromData();
  const [data, setData] = useState<Shipment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addressType, setAddressType] = useState<AddressType | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [dup, setDup] = useState("1");
  const [classification, setClassification] = useState<Classification | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

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
        setClassification(d.classification);
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
  const viaOt = isGta && addressType === "residential";
  const q = [a.address1, a.address2, a.city, a.provinceCode, a.postalCode]
    .filter(Boolean)
    .join(", ");
  const fullScreen = `app:app/ship/${data.numericId}`;
  const tooManyForModal = boxes.length > MODAL_BOX_LIMIT;

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
    setQuotes(null);
    await post({ intent: "confirm", addressType: t }); // boxes left as saved
  };

  const save = async (intent: "save" | "quote") => {
    setBusy(true);
    const r = await post({ intent, addressType, boxes });
    setBusy(false);
    if (!r) return;
    setQuotes(r.quotes);
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
        : [...bs, ...Array.from({ length: Math.min(n, MAX_BOXES - bs.length) }, () => ({ ...bs[bs.length - 1] }))],
    );
  };
  const totalKg = boxes.reduce((s, b) => s + (b.weightKg || 0), 0);

  return (
    <s-admin-action heading={`Ship ${data.order.name}`}>
      <s-stack gap="base">
        {TEST_BANNER}
        {/* ---- ship to + zone */}
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={isGta ? "success" : "info"}>{data.order.zone}</s-badge>
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
                {classification.source === "mock" ? <s-badge>Demo data</s-badge> : null}
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
              <s-button variant="tertiary" onClick={() => check("reclassify")} loading={checking}>
                Check again
              </s-button>
            </s-stack>
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
        {!addressType ? (
          <s-text color="subdued">Confirm Residential or Commercial to continue.</s-text>
        ) : viaOt ? (
          <s-banner tone="info" heading="Ships with OT">
            GTA residential — no dimensions or weight needed. Print OT&apos;s labels in OT.
            {data.otUrl ? null : " (Direct OT link not set up yet: close this and use OT's own action on this order.)"}
          </s-banner>
        ) : (
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200">
              {data.presets.map((p) => (
                <s-button
                  key={p.name}
                  onClick={() =>
                    setBoxes((bs) =>
                      bs.length >= MAX_BOXES
                        ? bs
                        : [...bs, { lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm, weightKg: p.weightKg, presetName: p.name }],
                    )
                  }
                >
                  + {p.name}
                </s-button>
              ))}
              <s-button
                variant="tertiary"
                onClick={() => setBoxes((bs) => [...bs, { lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0 }])}
              >
                + Custom
              </s-button>
            </s-stack>

            {tooManyForModal ? (
              <s-banner tone="info">
                {boxes.length} boxes — easier to edit in{" "}
                <s-link href={fullScreen}>full screen</s-link>.
              </s-banner>
            ) : null}

            {boxes.length > 0 ? (
              <s-table>
                <s-table-header-row>
                  <s-table-header>#</s-table-header>
                  <s-table-header>L cm</s-table-header>
                  <s-table-header>W cm</s-table-header>
                  <s-table-header>H cm</s-table-header>
                  <s-table-header>kg</s-table-header>
                  <s-table-header> </s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {boxes.map((b, i) => (
                    <s-table-row key={i}>
                      <s-table-cell>{i + 1}</s-table-cell>
                      {(["lengthCm", "widthCm", "heightCm", "weightKg"] as const).map((f) => (
                        <s-table-cell key={f}>
                          <s-number-field
                            label={f}
                            labelAccessibilityVisibility="exclusive"
                            value={b[f] ? String(b[f]) : ""}
                            min={0}
                            step={f === "weightKg" ? 0.1 : 1}
                            onInput={(e: Event) => setField(i, f, inputValue(e))}
                          />
                        </s-table-cell>
                      ))}
                      <s-table-cell>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          accessibilityLabel={`Remove box ${i + 1}`}
                          onClick={() => setBoxes((bs) => bs.filter((_, j) => j !== i))}
                        >
                          ✕
                        </s-button>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            ) : null}

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

            {quotes ? (
              quotes.length === 0 ? (
                <s-text>No quotes returned.</s-text>
              ) : (
                <s-stack gap="small-100">
                  <s-text type="strong">Quotes (mock — no real carriers yet)</s-text>
                  {quotes.map((qt) => (
                    <s-stack key={qt.id} direction="inline" gap="small-200" alignItems="center">
                      <s-text>
                        {qt.carrierName} {qt.serviceName}: ${qt.totalCad.toFixed(2)}
                        {qt.transitDays ? ` · ${qt.transitDays} d` : ""}
                      </s-text>
                      {data.history?.usual &&
                      courierKey(qt.carrierName) === courierKey(data.history.usual.courier) ? (
                        <s-badge tone="info">Usual</s-badge>
                      ) : null}
                    </s-stack>
                  ))}
                </s-stack>
              )
            ) : null}
          </s-stack>
        )}

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
      {viaOt && data.otUrl ? (
        <s-button slot="primary-action" href={data.otUrl} target="_blank">
          Print in OT
        </s-button>
      ) : addressType && !viaOt ? (
        <s-button slot="primary-action" onClick={() => save("quote")} loading={busy}>
          Get quotes
        </s-button>
      ) : null}
      <s-button slot="secondary-actions" href={fullScreen}>
        Open full screen
      </s-button>
      {addressType && !viaOt ? (
        <s-button slot="secondary-actions" onClick={() => save("save")}>
          Save
        </s-button>
      ) : null}
    </s-admin-action>
  );
}
