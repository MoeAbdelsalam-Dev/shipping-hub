import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  handleShipment,
  loadShipment,
  parseShipRequest,
} from "../lib/shipping.server";

/**
 * JSON API for the order-page action extension (extensions/ship-desk-action).
 * The extension calls fetch("/api/ship/<orderId>") — Shopify adds a session
 * token, authenticate.admin() verifies it, and cors() adds the headers the
 * admin extension sandbox needs. Same logic as the full-screen page.
 */

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session, cors } = await authenticate.admin(request);
  try {
    const data = await loadShipment(admin, session.shop, params.id ?? "");
    return cors(Response.json(data));
  } catch (e) {
    if (e instanceof Response) return cors(e);
    throw e;
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, cors } = await authenticate.admin(request);
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return cors(Response.json({ error: "Expected a JSON body" }, { status: 400 }));
  }
  try {
    const result = await handleShipment(
      admin,
      session.shop,
      params.id ?? "",
      parseShipRequest(body),
    );
    return cors(Response.json(result));
  } catch (e) {
    if (e instanceof Response) return cors(e);
    throw e;
  }
};
