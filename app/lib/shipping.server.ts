import db from "../db.server";
import { quoteAll, type AddressType, type Box, type Quote } from "../../carriers";
import { boxPresets, isValidBox, parseBoxes } from "./boxes";
import {
  classifyAddress,
  getCachedClassification,
  recordConfirmation,
} from "./classifier/index.server";
import type { Classification } from "./classifier/types";
import type { CourierHistory } from "./courier";
import { getCourierHistory } from "./history.server";
import { getOrder, orderNumericId, type AdminGraphql } from "./orders.server";
import { otOrderUrl } from "./ot";

/**
 * Shipment logic shared by the full-screen page (app/routes/app.ship.$id.tsx)
 * and the order-page action extension (app/routes/api.ship.$id.tsx).
 */

export function orderGid(id: string | undefined): string {
  if (id && /^gid:\/\/shopify\/Order\/\d+$/.test(id)) return id;
  if (!id || !/^\d+$/.test(id)) {
    throw new Response("Bad order id", { status: 400 });
  }
  return `gid://shopify/Order/${id}`;
}

export function parseAddressType(v: unknown): AddressType | null {
  return v === "residential" || v === "commercial" ? v : null;
}

export async function loadShipment(admin: AdminGraphql, shop: string, id: string) {
  const order = await getOrder(admin, orderGid(id));
  if (!order) throw new Response("Order not found", { status: 404 });

  const [draft, classification, history] = await Promise.all([
    db.shipmentDraft.findUnique({
      where: { shop_orderId: { shop, orderId: order.id } },
    }),
    getCachedClassification(shop, order.shipTo),
    getCourierHistory(admin, shop, order.customerId, order.id).catch(
      (e: unknown): CourierHistory | null => {
        // Message only: never log customer data.
        console.error("Courier history failed:", e instanceof Error ? e.name : "error");
        return null;
      },
    ),
  ]);

  return {
    order,
    numericId: orderNumericId(order.id),
    otUrl: otOrderUrl(order.id, order.name),
    shopifyOrderUrl: `shopify://admin/orders/${orderNumericId(order.id)}`,
    presets: boxPresets,
    classification,
    history,
    draft: draft
      ? {
          addressType: parseAddressType(draft.addressType),
          boxes: parseBoxes(draft.boxesJson),
        }
      : null,
  };
}

export type ShipmentData = Awaited<ReturnType<typeof loadShipment>>;

export type ShipIntent = "save" | "quote" | "classify" | "reclassify" | "confirm";

export interface ShipRequest {
  intent: ShipIntent;
  addressType: AddressType | null;
  /** Omitted (undefined) = leave the saved boxes alone. */
  boxes?: Box[];
}

export interface ShipResponse {
  intent: ShipIntent;
  saved: boolean;
  addressType: AddressType | null;
  quotes: Quote[] | null;
  errors: string[];
  classification: Classification | null;
}

const INTENTS: ShipIntent[] = ["save", "quote", "classify", "reclassify", "confirm"];

/** Accepts a FormData (page) or a parsed JSON body (extension). */
export function parseShipRequest(input: FormData | Record<string, unknown>): ShipRequest {
  const get = (k: string) =>
    input instanceof FormData ? input.get(k) : (input as Record<string, unknown>)[k];
  const intent = get("intent");
  const boxes = get("boxes");
  return {
    intent: INTENTS.includes(intent as ShipIntent) ? (intent as ShipIntent) : "save",
    addressType: parseAddressType(get("addressType")),
    boxes: boxes === null || boxes === undefined ? undefined : parseBoxes(boxes),
  };
}

export async function handleShipment(
  admin: AdminGraphql,
  shop: string,
  id: string,
  req: ShipRequest,
): Promise<ShipResponse> {
  const order = await getOrder(admin, orderGid(id));
  if (!order) throw new Response("Order not found", { status: 404 });

  const base: ShipResponse = {
    intent: req.intent,
    saved: false,
    addressType: req.addressType,
    quotes: null,
    errors: [],
    classification: null,
  };

  // ---- address classifier: suggestion only, never changes the shipment
  if (req.intent === "classify" || req.intent === "reclassify") {
    try {
      const classification = await classifyAddress(shop, order.shipTo, {
        force: req.intent === "reclassify",
      });
      return { ...base, classification };
    } catch (e) {
      // Error type only: messages from third-party APIs could echo the query.
      console.error("Address check failed:", e instanceof Error ? e.name : "error");
      return { ...base, errors: ["Automatic address check failed — check manually."] };
    }
  }

  // ---- everything else saves the draft
  const where = { shop_orderId: { shop, orderId: order.id } };
  const boxesJson = req.boxes ? JSON.stringify(req.boxes) : undefined;
  await db.shipmentDraft.upsert({
    where,
    create: {
      shop,
      orderId: order.id,
      orderName: order.name,
      addressType: req.addressType,
      boxesJson: boxesJson ?? "[]",
    },
    update: {
      addressType: req.addressType,
      ...(boxesJson !== undefined ? { boxesJson } : {}),
    },
  });
  // A Residential/Commercial choice is always a staff click: remember it.
  if (req.addressType) {
    await recordConfirmation(shop, order.shipTo, req.addressType);
  }

  if (req.intent !== "quote") return { ...base, saved: true };

  const draft = await db.shipmentDraft.findUnique({ where });
  const boxes = req.boxes ?? parseBoxes(draft?.boxesJson ?? "[]");
  const problems: string[] = [];
  if (!req.addressType) problems.push("Confirm Residential or Commercial first.");
  if (boxes.length === 0) problems.push("Add at least one box.");
  boxes.forEach((b, i) => {
    if (!isValidBox(b))
      problems.push(`Box ${i + 1}: every dimension and the weight must be > 0.`);
  });
  if (problems.length || !req.addressType) {
    return { ...base, saved: true, errors: problems };
  }

  const result = await quoteAll(order, boxes, req.addressType);
  return {
    ...base,
    saved: true,
    quotes: result.quotes,
    errors: result.errors.map((e) => `${e.carrierId}: ${e.message}`),
  };
}
