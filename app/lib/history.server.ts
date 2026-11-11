import db from "../db.server";
import { gql, type AdminGraphql } from "./orders.server";
import {
  UNKNOWN_COURIER,
  normalizeCourier,
  type CourierHistory,
} from "./courier";

/**
 * Which couriers this customer's earlier orders went with. Informational only:
 * it is NEVER used to decide residential/commercial.
 *
 * Source per earlier order: our own Shipment row if the app booked it,
 * otherwise Shopify's fulfillments[].trackingInfo.company (free text; blank or
 * "Other" counts as Unknown). Without read_all_orders Shopify only returns
 * roughly the last 60 days of orders.
 */

const HISTORY_SIZE = 10;

interface RawHistory {
  customer: {
    orders: {
      nodes: {
        id: string;
        name: string;
        createdAt: string;
        fulfillments: {
          createdAt: string;
          trackingInfo: { company: string | null; number: string | null }[];
        }[];
      }[];
    };
  } | null;
}

export async function getCourierHistory(
  admin: AdminGraphql,
  shop: string,
  customerId: string | null,
  currentOrderId: string,
): Promise<CourierHistory> {
  if (!customerId) {
    return { previousOrders: 0, usual: null, last: null, guest: true };
  }

  const data = await gql<RawHistory>(
    admin,
    `#graphql
      query CustomerCourierHistory($id: ID!, $first: Int!) {
        customer(id: $id) {
          orders(first: $first, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              createdAt
              fulfillments(first: 10) {
                createdAt
                trackingInfo(first: 10) { company number }
              }
            }
          }
        }
      }`,
    { id: customerId, first: HISTORY_SIZE + 1 },
  );

  const previous = (data.customer?.orders.nodes ?? [])
    .filter((o) => o.id !== currentOrderId)
    .slice(0, HISTORY_SIZE);
  if (previous.length === 0) {
    return { previousOrders: 0, usual: null, last: null, guest: false };
  }

  // Our own bookings win over Shopify's free-text tracking company.
  const ours = await db.shipment.findMany({
    where: { shop, orderId: { in: previous.map((o) => o.id) } },
    orderBy: { bookedAt: "desc" },
  });
  const oursByOrder = new Map<string, (typeof ours)[number]>();
  for (const s of ours) if (!oursByOrder.has(s.orderId)) oursByOrder.set(s.orderId, s);

  const perOrder = previous.map((o) => {
    const own = oursByOrder.get(o.id);
    if (own) {
      let tracking: string[] = [];
      try {
        tracking = JSON.parse(own.trackingNumbersJson);
      } catch {
        tracking = [];
      }
      return {
        orderName: o.name,
        courier: normalizeCourier(own.carrierName),
        date: own.bookedAt.toISOString(),
        trackingNumbers: tracking,
        shipped: true,
      };
    }
    // Latest fulfillment of that order.
    const f = [...o.fulfillments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const known = f?.trackingInfo.find((t) => normalizeCourier(t.company) !== UNKNOWN_COURIER);
    return {
      orderName: o.name,
      courier: normalizeCourier(known?.company ?? f?.trackingInfo[0]?.company),
      date: f?.createdAt ?? o.createdAt,
      trackingNumbers: (f?.trackingInfo ?? []).map((t) => t.number).filter((n): n is string => !!n),
      shipped: !!f,
    };
  });

  const counts = new Map<string, number>();
  for (const p of perOrder) {
    if (p.courier !== UNKNOWN_COURIER) counts.set(p.courier, (counts.get(p.courier) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  const shipped = perOrder
    .filter((p) => p.shipped)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  return {
    previousOrders: previous.length,
    usual: top ? { courier: top[0], count: top[1] } : null,
    last: shipped
      ? {
          courier: shipped.courier,
          date: shipped.date,
          orderName: shipped.orderName,
          trackingNumbers: shipped.trackingNumbers,
        }
      : null,
    guest: false,
  };
}
