import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  listUnfulfilledOrders,
  orderNumericId,
  syncZoneTags,
} from "../lib/orders.server";
import type { Zone } from "../lib/gta";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const orders = await listUnfulfilledOrders(admin);

  const drafts = await db.shipmentDraft.findMany({
    where: { shop: session.shop, orderId: { in: orders.map((o) => o.id) } },
    select: { orderId: true, boxesJson: true, addressType: true },
  });
  const draftByOrder = new Map(drafts.map((d) => [d.orderId, d]));

  return {
    orders: orders.map((o) => {
      const d = draftByOrder.get(o.id);
      return {
        id: o.id,
        numericId: orderNumericId(o.id),
        name: o.name,
        createdAt: o.createdAt,
        fulfillmentStatus: o.fulfillmentStatus,
        zone: o.zone,
        zoneTagged: o.tags.includes(o.zone),
        shipToName: o.shipTo.company || o.shipTo.name,
        city: o.shipTo.city,
        province: o.shipTo.provinceCode,
        postalCode: o.shipTo.postalCode,
        itemCount: o.itemCount,
        draftBoxes: d ? (JSON.parse(d.boxesJson) as unknown[]).length : 0,
        addressType: d?.addressType ?? null,
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orders = await listUnfulfilledOrders(admin);
  const changed = await syncZoneTags(admin, orders);
  return { changed };
};

type Filter = "All" | Zone;

export default function OrdersToShip() {
  const { orders } = useLoaderData<typeof loader>();
  const tagFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [filter, setFilter] = useState<Filter>("All");

  useEffect(() => {
    if (tagFetcher.data) {
      shopify.toast.show(
        tagFetcher.data.changed
          ? `Tagged ${tagFetcher.data.changed} order(s) in Shopify`
          : "All orders already tagged",
      );
    }
  }, [tagFetcher.data, shopify]);

  const counts = {
    All: orders.length,
    GTA: orders.filter((o) => o.zone === "GTA").length,
    "Non-GTA": orders.filter((o) => o.zone === "Non-GTA").length,
  };
  const shown =
    filter === "All" ? orders : orders.filter((o) => o.zone === filter);
  const syncing = tagFetcher.state !== "idle";

  return (
    <s-page heading="Orders to ship">
      <s-button
        slot="primary-action"
        onClick={() => tagFetcher.submit({}, { method: "POST" })}
        {...(syncing ? { loading: true } : {})}
      >
        Save GTA / Non-GTA tags to Shopify
      </s-button>

      <s-section>
        <s-stack direction="inline" gap="small-200">
          {(["All", "GTA", "Non-GTA"] as Filter[]).map((f) => (
            <s-button
              key={f}
              variant={filter === f ? "primary" : "secondary"}
              onClick={() => setFilter(f)}
            >
              {f} ({counts[f]})
            </s-button>
          ))}
        </s-stack>
      </s-section>

      <s-section padding="none">
        {shown.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No unfulfilled orders here.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Date</s-table-header>
              <s-table-header listSlot="secondary">Ship to</s-table-header>
              <s-table-header>Postal code</s-table-header>
              <s-table-header listSlot="inline">Zone</s-table-header>
              <s-table-header format="numeric">Items</s-table-header>
              <s-table-header>Shipment</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {shown.map((o) => (
                <s-table-row key={o.id}>
                  <s-table-cell>
                    <s-link href={`/app/ship/${o.numericId}`}>{o.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    {new Date(o.createdAt).toLocaleDateString("en-CA")}
                  </s-table-cell>
                  <s-table-cell>
                    {o.shipToName}
                    {o.city ? `, ${o.city} ${o.province}` : ""}
                  </s-table-cell>
                  <s-table-cell>{o.postalCode}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={o.zone === "GTA" ? "success" : "info"}>
                      {o.zone}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{o.itemCount}</s-table-cell>
                  <s-table-cell>
                    {o.draftBoxes > 0
                      ? `${o.draftBoxes} box${o.draftBoxes > 1 ? "es" : ""}`
                      : "—"}
                    {o.addressType
                      ? ` · ${o.addressType === "residential" ? "Res" : "Com"}`
                      : ""}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button href={`/app/ship/${o.numericId}`}>Ship</s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
