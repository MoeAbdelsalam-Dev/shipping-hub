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
  /** Shopify customer GID, null for guest checkouts. */
  customerId: string | null;
}

const ORDER_FIELDS = `#graphql
  fragment ShipOrderFields on Order {
    id
    name
    createdAt
    displayFulfillmentStatus
    tags
    email
    phone
    customer { id }
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
  email: string | null;
  phone: string | null;
  customer: { id: string } | null;
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
    // Shipping-address phone first, else the order's contact phone.
    phone: a?.phone || o.phone,
  };
  const lineItems = o.lineItems.nodes
    .filter((li) => li.currentQuantity > 0)
    .map((li) => ({ name: li.name, sku: li.sku, quantity: li.currentQuantity }));
  return {
    id: o.id,
    name: o.name,
    orderNumber: o.name.replace(/^#/, ""),
    email: o.email,
    customerId: o.customer?.id ?? null,
    createdAt: o.createdAt,
    fulfillmentStatus: o.displayFulfillmentStatus,
    tags: o.tags,
    shipTo,
    zone: zoneFor(shipTo.postalCode, shipTo.countryCode),
    itemCount: lineItems.reduce((n, li) => n + li.quantity, 0),
    lineItems,
  };
}

export async function gql<T>(
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

// TEST MODE: the app is read-only (scopes read_orders, read_customers).
// The old "Save GTA / Non-GTA tags to Shopify" mutation (tagsAdd/tagsRemove)
// was removed on purpose — see git history before re-adding it, and it needs
// write_orders.

/** Numeric part of gid://shopify/Order/123 -> "123" (for URLs). */
export function orderNumericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}
