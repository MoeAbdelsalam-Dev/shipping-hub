import otConfig from "../../config/ot.json";

/**
 * Link to OT's page for a Shopify order, or null while the URL pattern is
 * still unknown (config/ot.json -> orderUrlTemplate is empty).
 */
export function otOrderUrl(orderGid: string, orderName: string): string | null {
  const tpl = otConfig.orderUrlTemplate.trim();
  if (!tpl) return null;
  const numericId = orderGid.split("/").pop() ?? "";
  return tpl
    .replaceAll("{orderId}", encodeURIComponent(numericId))
    .replaceAll("{orderName}", encodeURIComponent(orderName.replace(/^#/, "")));
}
