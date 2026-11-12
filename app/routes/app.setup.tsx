import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { TestModeBanner } from "../components/TestModeBanner";
import { SHIP_FROM_KEY } from "../lib/locations.server";
import { setSetting } from "../lib/settings.server";
import {
  MANUAL_ITEMS,
  STATUS_LABEL,
  STATUS_TONE,
  checklistHtml,
  manualKey,
  type SetupItem,
} from "../lib/setup";
import { buildChecklist } from "../lib/setup.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { items, locations, shipFromId } = await buildChecklist(
    admin,
    session.shop,
    session.scope ?? "",
  );
  return { shop: session.shop, items, locations, shipFromId };
};

/** Writes only to our own database (checklist state, ship-from choice). */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "status") {
    const id = String(form.get("id"));
    const status = String(form.get("status"));
    if (!(MANUAL_ITEMS as readonly string[]).includes(id)) {
      return { ok: false as const };
    }
    await setSetting(
      session.shop,
      manualKey(id),
      status === "done" || status === "waiting" ? status : null,
    );
    return { ok: true as const };
  }

  if (intent === "shipFrom") {
    const { locations } = await buildChecklist(admin, session.shop, session.scope ?? "");
    const id = String(form.get("locationId"));
    if (!locations.some((l) => l.id === id)) return { ok: false as const };
    await setSetting(session.shop, SHIP_FROM_KEY, id);
    return { ok: true as const };
  }

  return { ok: false as const };
};

function ItemCard({ item }: { item: SetupItem }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle" ? { loading: true } : {};
  const setStatus = (status: string) =>
    fetcher.submit({ intent: "status", id: item.id, status }, { method: "POST" });
  const manual = !item.auto && (MANUAL_ITEMS as readonly string[]).includes(item.id);

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</s-badge>
          <s-text type="strong">{item.title}</s-text>
          {item.auto ? <s-text color="subdued">(checked automatically)</s-text> : null}
        </s-stack>
        <s-text>
          <s-text type="strong">Who: </s-text>
          {item.who}
        </s-text>
        <s-text>
          <s-text type="strong">Why: </s-text>
          {item.why}
        </s-text>
        <s-text>
          <s-text type="strong">Where it goes: </s-text>
          {item.where}
        </s-text>
        {item.env?.length ? (
          <s-stack direction="inline" gap="small-200">
            {item.env.map((e) => (
              <s-badge key={e.name} tone={e.set ? "success" : e.optional ? "neutral" : "warning"}>
                {e.name}
                {e.optional ? " (optional)" : ""}: {e.set ? "set" : "missing"}
              </s-badge>
            ))}
          </s-stack>
        ) : null}
        {item.details?.map((d) => (
          <s-text key={d} color="subdued">
            {d}
          </s-text>
        ))}
        {manual ? (
          <s-stack direction="inline" gap="small-200">
            <s-button
              variant={item.status === "done" ? "primary" : "secondary"}
              onClick={() => setStatus("done")}
              {...busy}
            >
              Mark done
            </s-button>
            <s-button
              variant={item.status === "waiting" ? "primary" : "secondary"}
              onClick={() => setStatus("waiting")}
              {...busy}
            >
              Mark waiting
            </s-button>
            {item.status !== "not-started" ? (
              <s-button variant="tertiary" onClick={() => setStatus("reset")} {...busy}>
                Reset
              </s-button>
            ) : null}
          </s-stack>
        ) : null}
      </s-stack>
    </s-box>
  );
}

export default function Setup() {
  const { shop, items, locations, shipFromId } = useLoaderData<typeof loader>();
  const shipFromFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const done = items.filter((i) => i.status === "done").length;
  const needed = items.filter((i) => i.status !== "later").length;

  const print = () => {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      shopify.toast.show("Allow pop-ups to print the checklist", { isError: true });
      return;
    }
    w.document.write(checklistHtml(items, shop));
    w.document.close();
  };

  return (
    <s-page heading="Setup — what we need">
      <s-button slot="primary-action" icon="print" onClick={print}>
        Print this checklist
      </s-button>

      <TestModeBanner />

      <s-section>
        <s-paragraph>
          {done} of {needed} done. Statuses for carrier keys, scopes, locations and box sizes are
          detected automatically; secret values are never shown. Keys go into Railway
          variables — never into this page or chat.
        </s-paragraph>
      </s-section>

      <s-section heading="Checklist">
        <s-stack gap="base">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Ship-from address (Shopify Locations)">
        {locations.length === 0 ? (
          <s-paragraph>
            No locations readable yet. The app needs the read_locations permission — open Ship
            Desk once and accept the updated permissions.
          </s-paragraph>
        ) : (
          <s-stack gap="small-200">
            {locations.map((l) => (
              <s-stack key={l.id} direction="inline" gap="small-200" alignItems="center">
                <s-text>
                  <s-text type="strong">{l.name}</s-text> — {l.address1}
                  {l.address2 ? `, ${l.address2}` : ""}, {l.city} {l.provinceCode} {l.postalCode}
                </s-text>
                {shipFromId === l.id ? (
                  <s-badge tone="success">Ship-from (confirmed)</s-badge>
                ) : (
                  <s-button
                    onClick={() =>
                      shipFromFetcher.submit(
                        { intent: "shipFrom", locationId: l.id },
                        { method: "POST" },
                      )
                    }
                    {...(shipFromFetcher.state !== "idle" ? { loading: true } : {})}
                  >
                    Use as ship-from
                  </s-button>
                )}
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
