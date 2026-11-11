@AGENTS.md

# Ship Desk — shipping app for one Shopify store

Embedded Shopify admin app (custom app, installed on our one store only) that
replaces the manual shipping routine:
look at each unfulfilled order → decide GTA vs outside GTA → decide
residential vs commercial (usually by Googling the address; if still unclear,
contact the customer) → enter boxes (dimensions + weight, multi-piece, 18+
boxes seen) → compare quotes → book → print labels.

## Carriers

| Carrier | Integration | Phase |
|---|---|---|
| **OT** (local courier) | **No API.** Web page automation — see "OT adapter" | 2 |
| UPS | Official API | 3 |
| Canada Post | Official API | 3 |
| FedEx | Official API | 3 |

No other carriers. Don't add any without being asked.

**Key business rule:** a *GTA + residential* order ships with **OT** and needs
no dimensions and no weight. Staff open the order in OT and print **OT's**
label. We do not deliver ourselves and we never make our own labels. The app
shows an "Open in OT to print labels" step for these orders (URL pattern in
`config/ot.json`, TBD — until set, it links to the Shopify order so staff can
use OT's order action button). Everything else goes through the boxes →
quotes flow.

## Stack

- Shopify CLI app, React Router 7 template, TypeScript, Polaris web components
  (`<s-page>`, `<s-table>`, …) and App Bridge.
- `AppDistribution.SingleMerchant` in `app/shopify.server.ts` (single-store
  custom app).
- Prisma + SQLite. Locally `file:dev.sqlite`; on Railway a volume mounted at
  `/data` with `DATABASE_URL=file:/data/prod.sqlite`. One store, low volume —
  SQLite is enough. Move to Postgres only if we ever need multiple replicas.
- Hosted on Railway from the `Dockerfile` (`railway.json` pins the builder).
  Container start runs `prisma migrate deploy` then the server.
- Node >= 22.12 (some deps need >= 22.15).

## Layout

```
config/
  gta_fsa.json      GTA definition: "prefixes" (e.g. all of M) + "fsas" grouped by region
  boxes.json        Box presets (cm / kg) shown as one-click buttons
  ot.json           OT order-page URL template (TBD after recon)
carriers/
  types.ts          CarrierAdapter interface + Box, Quote, Booking, Label, AddressType
  index.ts          Registry: carriers[], getCarrier(), carrierForQuote(), quoteAll()
  mock.ts           Fake carrier (only registered carrier today)
  ot.ts             OT adapter STUB — not registered until Phase 2
app/
  lib/gta.ts        fsaOf(), zoneFor() — pure, safe on client and server
  lib/boxes.ts      presets, parseBoxes() (sanitizes form input), MAX_BOXES = 99
  lib/ot.ts         otOrderUrl() from config/ot.json
  lib/orders.server.ts   Admin GraphQL: listUnfulfilledOrders, getOrder, syncZoneTags
  routes/app._index.tsx  Orders to ship (list, GTA filter, "save tags to Shopify")
  routes/app.ship.$id.tsx  Shipment screen for one order (id = numeric order id)
prisma/schema.prisma  Session (Shopify) + ShipmentDraft (per-order saved boxes/address type)
```

## Data flow (shipment screen)

1. Loader fetches the order from Shopify + any `ShipmentDraft`.
2. Staff use "Search address on Google" / "Open in Google Maps" (plain links,
   new tab) and pick **Residential** or **Commercial**. A company name on the
   address is shown as a hint only — never auto-decided (until Phase 4, and
   even then staff confirm).
3. GTA + Residential → "Open in OT to print labels". Nothing else to enter.
4. Otherwise → box table (presets, custom, Duplicate ×N, remove) → "Get quotes".
   The action upserts the draft, validates, then calls `quoteAll()`.

## Carrier adapter contract

```ts
interface CarrierAdapter {
  id: string; name: string;
  getQuotes(order: ShipOrder, boxes: Box[], addressType: AddressType): Promise<Quote[]>;
  book(quoteId: string): Promise<Booking>;
  getLabels(shipmentId: string): Promise<Label[]>;
}
```

- One file per carrier in `/carriers`, registered in `carriers/index.ts`.
  Register a carrier only when its credentials/config exist.
- `Quote.id` MUST start with `"<carrierId>:"` — that's how `book()` is routed.
- Adapter layer is metric (cm, kg) and CAD. Convert inside the adapter.
- One box = one piece = one tracking number = one label, same order as `boxes`.
- An adapter that throws must not break the others (`quoteAll` uses allSettled).
- Never log full payloads with customer addresses or credentials.

## OT adapter (plan — not built)

OT has no API. Today staff click **OT's order action button** on the Shopify
order page; it opens an OT page with the order pre-filled. Staff enter only:

- dimensions (L/W/H cm) and weight (kg) **per box** — multi-piece, 18+ boxes,
- residential / commercial.

OT then shows quotes from its **sub-couriers**; staff pick one, book, and
print OT's labels. `carriers/ot.ts` will automate exactly that page:
`getQuotes` = open the pre-filled page, fill boxes + address type, read the
sub-courier quotes; `book` = select the quote and confirm; `getLabels` =
download OT's labels and tracking numbers. Quote ids:
`ot:<sub-courier>:<service>:<ref>`. The GTA-residential case uses the same
page with nothing to fill in.

Driver — **decide after recon**, adapter interface is the same either way:

- **A. Playwright on the server (Railway):** fully automatic from our app;
  needs an OT login stored as Railway secrets, a headless Chromium in the
  Docker image, and session/2FA handling. Breaks if OT changes its page.
- **B. Chrome extension on the work PC:** fills the OT page the staff member
  opens, using their existing OT session; no OT credentials on our server;
  only works on that PC/browser. Our app sends the boxes to the extension.

Recon to do first (record answers here): exact pre-filled page URL pattern
(→ `config/ot.json`), login/session lifetime/2FA, form selectors for pieces
and res/com, how quotes render, how booking works, label format (PDF/ZPL) and
download, tracking numbers, and whether OT's terms allow automation.

## Phases

1. **Foundation (done)** — unfulfilled order list, GTA/Non-GTA zoning from
   FSA list (+ optional write of order tags), shipment screen with boxes,
   presets, Duplicate ×N, Residential/Commercial, "Open in OT" step for GTA
   residential, carrier interface + mock quotes, saved drafts.
2. **OT automation** — recon, choose Playwright vs Chrome extension, implement
   `carriers/ot.ts` (quotes from OT sub-couriers, book, OT labels for all
   boxes), `Shipment` table for bookings, create the Shopify fulfillment with
   tracking numbers (needs fulfillment scopes). Fill in the OT URL pattern.
3. **UPS, Canada Post, FedEx** — official API adapters (sandbox first), quotes
   side by side with OT, book + labels + tracking, preferred-carrier rules.
4. **Auto-classify residential/commercial** — Google Places / Address
   Validation API suggests Residential or Commercial with the reason shown;
   staff always confirm. Keep the manual Google/Maps buttons.
5. **Daily workflow + hardening** — bulk actions across orders, pickups and
   end-of-day manifests, void/re-print, packing slips; shipping cost vs.
   charged reports, audit log, error alerts, Railway DB backups, adapter tests.

## Conventions

- TypeScript strict; `npm run typecheck` and `npm run lint` must pass.
- Files that touch Shopify, the DB or secrets end in `.server.ts` (or live in
  route loaders/actions). `app/lib/*.ts` without `.server` must stay
  browser-safe.
- Admin GraphQL only (no REST). Pin to the API version in `shopify.server.ts`.
- Polaris web components only. In React 18, use `onInput` (not `onChange`) on
  `s-text-field` / `s-number-field`; avoid `s-select`/choice components whose
  change events React 18 doesn't wire — use buttons instead.
- Business config lives in `/config/*.json`, not in code. Changing the GTA
  list, box presets or OT URL must not require touching TypeScript.
- Money in CAD with 2 decimals; dimensions cm, weight kg, everywhere.
- New tables → `npx prisma migrate dev --name <what>`; commit the migration.
- Customer addresses are PII: no addresses in logs, URLs we control, or
  third-party calls other than the carrier being quoted and Google lookups the
  staff member clicks themselves.

## Commands

- `npm run dev` — `shopify app dev` (tunnel + install on dev store)
- `npm run typecheck`, `npm run lint`, `npm run build`
- `npm run deploy` — push `shopify.app.toml` (scopes, URLs, webhooks) to Shopify
