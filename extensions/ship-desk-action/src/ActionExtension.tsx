import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

/**
 * Order page → More actions → "Ship with Ship Desk".
 * Shows a short order summary and ONE big button that opens the standalone
 * Ship Desk page (/desk/:orderId) in a new tab, like OT's own order button.
 * The signed 30-minute link comes from /api/desk-link/:id; the summary from
 * /api/ship/:id (Shopify adds the session token to both relative fetches).
 */

export default async () => {
  render(<Extension />, document.body);
};

// ---- response shapes (subset of app/lib/shipping.server.ts loadShipment)
interface CourierHistory {
  previousOrders: number;
  usual: { courier: string; count: number } | null;
  guest: boolean;
}
interface Summary {
  numericId: string;
  history: CourierHistory | null;
  poBox: { isPoBox: boolean; poBoxOnly: boolean };
  draft: { addressType: "residential" | "commercial" | null } | null;
  order: {
    name: string;
    zone: "GTA" | "Non-GTA";
    shipTo: { name: string; company?: string | null; city: string; provinceCode: string };
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Ship Desk returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

function historyLine(h: CourierHistory | null): string {
  if (!h) return "";
  if (h.guest) return "Guest checkout";
  if (h.previousOrders === 0) return "First-time customer";
  const n = h.previousOrders;
  return `${n} previous order${n === 1 ? "" : "s"} · Usually ships with: ${
    h.usual ? `${h.usual.courier} (${h.usual.count} of ${n})` : "Unknown"
  }`;
}

function Extension() {
  const gid = shopify.data.selected[0]?.id ?? "";
  const id = gid.split("/").pop() || "";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [deskUrl, setDeskUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("No order selected.");
      return;
    }
    Promise.all([
      getJson<Summary>(`/api/ship/${id}`),
      getJson<{ url: string }>(`/api/desk-link/${id}`),
    ])
      .then(([s, link]) => {
        setSummary(s);
        setDeskUrl(link.url);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) {
    return (
      <s-admin-action heading="Ship Desk">
        <s-banner tone="critical">{error}</s-banner>
        <s-button slot="secondary-actions" onClick={() => shopify.close()}>
          Close
        </s-button>
      </s-admin-action>
    );
  }
  if (!summary || !deskUrl) return <s-admin-action heading="Ship Desk" loading />;

  const a = summary.order.shipTo;
  const isGta = summary.order.zone === "GTA";
  const viaOt = isGta && summary.draft?.addressType === "residential";

  return (
    <s-admin-action heading={`Ship ${summary.order.name}`}>
      <s-stack gap="base">
        <s-banner tone="warning" heading="TEST MODE — read-only">
          Nothing is shipped, booked, or changed.
        </s-banner>

        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={isGta ? "success" : "info"}>{summary.order.zone}</s-badge>
            {summary.poBox.isPoBox ? <s-badge tone="info">PO Box → CP</s-badge> : null}
            {viaOt ? <s-badge tone="success">Ships with OT</s-badge> : null}
          </s-stack>
          <s-text type="strong">{a.company || a.name}</s-text>
          <s-text color="subdued">
            {a.company ? `${a.name} · ` : ""}
            {a.city} {a.provinceCode}
          </s-text>
          {summary.history ? <s-text color="subdued">{historyLine(summary.history)}</s-text> : null}
        </s-stack>

        <s-button variant="primary" href={deskUrl} target="_blank">
          Open Ship Desk
        </s-button>
        <s-text color="subdued">
          Opens in a new tab. The link works for 30 minutes — reopen from here if it expires.
        </s-text>
      </s-stack>

      <s-button slot="primary-action" href={deskUrl} target="_blank">
        Open Ship Desk
      </s-button>
      <s-button slot="secondary-actions" href={`app:app/ship/${summary.numericId}`}>
        Open inside Shopify (fallback)
      </s-button>
    </s-admin-action>
  );
}
