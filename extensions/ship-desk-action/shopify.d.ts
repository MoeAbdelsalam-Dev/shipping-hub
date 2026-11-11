// Types for the `shopify` global and the admin web components (s-*) in this
// extension target. `shopify app dev` generates an equivalent file.
import "@shopify/ui-extensions/preact";
import type { Api } from "@shopify/ui-extensions/admin.order-details.action.render";

declare global {
  const shopify: Api;
}
