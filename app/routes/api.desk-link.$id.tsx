import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { DESK_LINK_TTL_SECONDS, deskUrl } from "../lib/deskLink.server";

/**
 * Signed link to the standalone Ship Desk page for one order. Called by the
 * order-page action extension (session token → authenticate.admin + cors).
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, cors } = await authenticate.admin(request);
  const id = params.id ?? "";
  if (!/^\d+$/.test(id)) {
    return cors(Response.json({ error: "Bad order id" }, { status: 400 }));
  }
  return cors(
    Response.json({ url: deskUrl(session.shop, id), expiresInSeconds: DESK_LINK_TTL_SECONDS }),
  );
};
