/**
 * Shown on every page while the app runs as a read-only test build
 * (scopes: read_orders, read_customers; no Shopify mutations, no carrier or
 * OT calls). Remove when the app is allowed to book shipments.
 */
export function TestModeBanner() {
  return (
    <s-banner tone="warning" heading="TEST MODE — read-only">
      Nothing is shipped, booked, or changed.
    </s-banner>
  );
}
