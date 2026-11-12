import db from "../db.server";
import type { AddressType, Box } from "../../carriers";
import { boxPresets, parseBoxes } from "./boxes";
import type { CarrierRow } from "./carrierRows";
import {
  ClassifierNotConnectedError,
  classifierNeeds,
  classifyAddress,
  getCachedClassification,
  recordConfirmation,
} from "./classifier/index.server";
import type { Classification } from "./classifier/types";
import type { CourierHistory } from "./courier";
import { getCourierHistory } from "./history.server";
import { getShipFrom } from "./locations.server";
import { getOrder, orderNumericId, type AdminGraphql } from "./orders.server";
import { otOrderUrl } from "./ot";
import { groupBoxes, validatePackages } from "./packages";
import { carrierRows, quoteRows } from "./quotes.server";
import { detectPoBox, shipRoute } from "./rules";

/**
 * Shipment logic shared by the full-screen page (app/routes/app.ship.$id.tsx)
 * and the order-page action extension (app/routes/api.ship.$id.tsx).
 * Read-only build: nothing here writes to Shopify or calls a carrier.
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

function parseBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return v === true || v === "true" || v === "1" || v === "on";
}

export async function loadShipment(admin: AdminGraphql, shop: string, id: string) {
  const order = await getOrder(admin, orderGid(id));
  if (!order) throw new Response("Order not found", { status: 404 });

  const [draft, classification, history, shipFrom] = await Promise.all([
    db.shipmentDraft.findUnique({
      where: { shop_orderId: { shop, orderId: order.id } },
    }),
    getCachedClassification(shop, order.shipTo),
    getCourierHistory(admin, shop, order.customerId, order.id).catch(
      (e: unknown): CourierHistory | null => {
        // Error type only: never log customer data.
        console.error("Courier history failed:", e instanceof Error ? e.name : "error");
        return null;
      },
    ),
    getShipFrom(admin, shop),
  ]);

  const addressType = parseAddressType(draft?.addressType);
  const signatureRequired = draft?.signatureRequired ?? false;
  const po = detectPoBox(order.shipTo.address1, order.shipTo.address2);

  return {
    order,
    numericId: orderNumericId(order.id),
    otUrl: otOrderUrl(order.id, order.name),
    shopifyOrderUrl: `shopify://admin/orders/${orderNumericId(order.id)}`,
    presets: boxPresets,
    classification,
    classifierNeeds: classifierNeeds(),
    history,
    shipFrom: shipFrom.location,
    poBox: { isPoBox: po.isPoBox, poBoxOnly: po.isPoBox && !po.street },
    rows: carrierRows(order, {
      addressType,
      signatureRequired,
      usualCourier: history?.usual?.courier ?? null,
    }),
    draft: draft
      ? { addressType, signatureRequired, boxes: parseBoxes(draft.boxesJson) }
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
  /** Omitted = leave the saved value alone. */
  signatureRequired?: boolean;
  /** "Preview with sample prices" toggle. */
  sample: boolean;
}

export interface ShipResponse {
  intent: ShipIntent;
  saved: boolean;
  addressType: AddressType | null;
  /** Carrier rows; with quotes only for intent "quote". */
  rows: CarrierRow[] | null;
  quoted: boolean;
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
    signatureRequired: parseBool(get("signatureRequired")),
    sample: parseBool(get("sample")) ?? false,
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
    rows: null,
    quoted: false,
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
      if (e instanceof ClassifierNotConnectedError) {
        return {
          ...base,
          errors: [`Address check not connected — needs ${classifierNeeds().join(", ")}.`],
        };
      }
      // Error type only: messages from third-party APIs could echo the query.
      console.error("Address check failed:", e instanceof Error ? e.name : "error");
      return { ...base, errors: ["Automatic address check failed — check manually."] };
    }
  }

  // ---- everything else saves the draft (our database only)
  const where = { shop_orderId: { shop, orderId: order.id } };
  const boxesJson = req.boxes ? JSON.stringify(req.boxes) : undefined;
  const draft = await db.shipmentDraft.upsert({
    where,
    create: {
      shop,
      orderId: order.id,
      orderName: order.name,
      addressType: req.addressType,
      boxesJson: boxesJson ?? "[]",
      signatureRequired: req.signatureRequired ?? false,
    },
    update: {
      addressType: req.addressType,
      ...(boxesJson !== undefined ? { boxesJson } : {}),
      ...(req.signatureRequired !== undefined
        ? { signatureRequired: req.signatureRequired }
        : {}),
    },
  });
  // A Residential/Commercial choice is always a staff click: remember it.
  if (req.addressType) {
    await recordConfirmation(shop, order.shipTo, req.addressType);
  }

  const history = await getCourierHistory(admin, shop, order.customerId, order.id).catch(
    () => null,
  );
  const opts = {
    addressType: req.addressType,
    signatureRequired: draft.signatureRequired,
    usualCourier: history?.usual?.courier ?? null,
  };

  if (req.intent !== "quote") {
    return { ...base, saved: true, rows: carrierRows(order, opts) };
  }

  const boxes = req.boxes ?? parseBoxes(draft.boxesJson);
  const problems: string[] = [];
  if (!req.addressType) problems.push("Confirm Residential or Commercial first.");
  if (req.addressType && shipRoute(order.zone, req.addressType) === "print-in-ot") {
    problems.push("GTA residential ships with OT — use Print in OT, no quotes needed.");
  }
  // Same rules and wording as the package entry on both pages.
  problems.push(...validatePackages(groupBoxes(boxes)));
  if (problems.length || !req.addressType) {
    return { ...base, saved: true, rows: carrierRows(order, opts), errors: problems };
  }

  return {
    ...base,
    saved: true,
    quoted: true,
    rows: await quoteRows(order, boxes, req.addressType, { ...opts, sample: req.sample }),
  };
}
