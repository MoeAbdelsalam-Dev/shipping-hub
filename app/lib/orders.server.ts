import type { ShipAddress, ShipOrder } from "../../carriers/types";
import { zoneFor, type Zone } from "./gta";

/** Minimal shape of the admin GraphQL client from authenticate.admin(). */
export interface AdminGraphql {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface OrderSummary extends ShipOrder {
  createdAt: string;
  fulfillmentStatus: string;
  tags: string[];
  zone: Zone;
  /** Total line item quantity, to hint how many boxes to expect. */
  itemCount: number;
  lineItems: { name: string; sku: string | null; quantity: number }[];
}

const ORDER_FIELDS = `#graphql
  fragment ShipOrderFields on Order {
    id
    name
    createdAt
    displayFulfillmentStatus
    tags
    shippingAddress {
      name
      company
      address1
      address2
      city
      provinceCode
      zip
      countryCodeV2
      phone
    }
    lineItems(first: 100) {
      nodes { name sku currentQuantity }
    }
  }
`;

interface RawOrder {
  id: string;
  name: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  tags: string[];
  shippingAddress: {
    name: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    provinceCode: string | null;
    zip: string | null;
    countryCodeV2: string | null;
    phone: string | null;
  } | null;
  lineItems: {
    nodes: { name: string; sku: string | null; currentQuantity: number }[];
  };
}

function toSummary(o: RawOrder): OrderSummary {
  const a = o.shippingAddress;
  const shipTo: ShipAddress = {
    name: a?.name ?? "",
    company: a?.company,
    address1: a?.address1 ?? "",
    address2: a?.address2,
    city: a?.city ?? "",
    provinceCode: a?.provinceCode ?? "",
    postalCode: a?.zip ?? "",
    countryCode: a?.countryCodeV2 ?? "",
    phone: a?.phone,
  };
  const lineItems = o.lineItems.nodes
    .filter((li) => li.currentQuantity > 0)
    .map((li) => ({ name: li.name, sku: li.sku, quantity: li.currentQuantity }));
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    fulfillmentStatus: o.displayFulfillmentStatus,
    tags: o.tags,
    shipTo,
    zone: zoneFor(shipTo.postalCode, shipTo.countryCode),
    itemCount: lineItems.reduce((n, li) => n + li.quantity, 0),
    lineItems,
  };
}

async function gql<T>(
  admin: AdminGraphql,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!json.data) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/** Open orders that still have something to ship (unfulfilled or partial). */
export async function listUnfulfilledOrders(
  admin: AdminGraphql,
): Promise<OrderSummary[]> {
  const data = await gql<{ orders: { nodes: RawOrder[] } }>(
    admin,
    `#graphql
      ${ORDER_FIELDS}
      query UnfulfilledOrders {
        orders(
          first: 100
          sortKey: CREATED_AT
          reverse: true
          query: "status:open AND (fulfillment_status:unshipped OR fulfillment_status:partial)"
        ) {
          nodes { ...ShipOrderFields }
        }
      }`,
  );
  return data.orders.nodes
    .filter((o) => o.shippingAddress) // pickup / digital orders have nothing to ship
    .map(toSummary);
}

export async function getOrder(
  admin: AdminGraphql,
  id: string,
): Promise<OrderSummary | null> {
  const data = await gql<{ order: RawOrder | null }>(
    admin,
    `#graphql
      ${ORDER_FIELDS}
      query ShipOrder($id: ID!) {
        order(id: $id) { ...ShipOrderFields }
      }`,
    { id },
  );
  return data.order ? toSummary(data.order) : null;
}

/** Put exactly one of GTA / Non-GTA on each order in Shopify. */
export async function syncZoneTags(
  admin: AdminGraphql,
  orders: OrderSummary[],
): Promise<number> {
  let changed = 0;
  for (const o of orders) {
    const wrong = o.zone === "GTA" ? "Non-GTA" : "GTA";
    const needsAdd = !o.tags.includes(o.zone);
    const needsRemove = o.tags.includes(wrong);
    if (!needsAdd && !needsRemove) continue;
    if (needsRemove) {
      await gql(
        admin,
        `#graphql
          mutation RemoveZoneTag($id: ID!, $tags: [String!]!) {
            tagsRemove(id: $id, tags: $tags) { userErrors { message } }
          }`,
        { id: o.id, tags: [wrong] },
      );
    }
    if (needsAdd) {
      await gql(
        admin,
        `#graphql
          mutation AddZoneTag($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) { userErrors { message } }
          }`,
        { id: o.id, tags: [o.zone] },
      );
    }
    changed++;
  }
  return changed;
}

/** Numeric part of gid://shopify/Order/123 -> "123" (for URLs). */
export function orderNumericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}
