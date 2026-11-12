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
| UPS | Official API (`carriers/ups.ts` stub) | 4 |
| Canada Post | Official API (`carriers/canadapost.ts` stub) | 4 |
| FedEx | Official API — not in the presentation build | later |

No other carriers. Don't add any without being asked. The quotes list always
shows one row per carrier (UPS, Canada Post, OT): connected → real quotes;
not connected → "Not connected — needs <ENV…>" + link to the Setup page.

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

## TEST MODE — read-only build (current)

The app is installed on the real store as a **read-only test build**:

- Scopes: `read_orders,read_customers,read_locations` only
  (`shopify.app.toml`, `.env.example`). No write scopes. Do not add any until
  test mode ends.
- No Shopify mutations anywhere in the code (the old GTA tag sync —
  `tagsAdd`/`tagsRemove`, needing `write_orders` — was removed).
- No carrier or OT calls: the UPS / Canada Post / OT adapters are stubs that
  only read env vars to report "connected" and throw "not built yet" — no
  network. "Preview with sample prices" quotes are generated locally
  (`carriers/sample.ts`, labelled SAMPLE). "Print labels" is disabled;
  "Preview sample label" draws a watermarked 4x6 page in the browser.
  "Print in OT" is a plain link staff click.
- No demo data by default: the address check shows "Not connected — needs
  BRAVE_SEARCH_API_KEY, ANTHROPIC_API_KEY" until keys exist
  (`CLASSIFIER_DEMO=1` turns the built-in demo back on for development only).
- Yellow `TestModeBanner` on every page and in the order modal: "TEST MODE —
  read-only. Nothing is shipped, booked, or changed."
- Our own database is still written (shipment drafts, address-check cache,
  staff confirmations) — that is app state, not store data.
- Outgoing network calls: Shopify Admin GraphQL (queries only: orders,
  order, customer order history, locations); Brave Search
  + Claude API only if their keys are set and only when staff click "Check
  address"; the order modal → our own `/api/ship/:id`. Google/Maps/evidence
  links open in the staff member's browser, not from our server.

## Order data we read

Per order (`app/lib/orders.server.ts`): order number, contact **email**,
contact phone, full shipping address incl. **company**, **address2/unit**,
shipping phone, line items, customer id.

`ShipOrder` (carriers/types.ts) carries `orderNumber` and `email` to every
adapter:
- **orderNumber** goes in the carrier's **reference** field where the mapping
  says so (Canada Post, OT — not UPS, see Rules).
- **email** is passed to the carrier for its tracking notifications only.

## Rules (config-driven, unit-tested — `npm test`)

All in `app/lib/rules.ts`, config in `config/rules.json` and
`config/carrier_fields.json`, tests in `app/lib/rules.test.ts`:

- **GTA + residential** → skip quotes; one "Print in OT" button.
- **PO Box** (PO Box, P.O. Box, POB, Box <n>, C.P. <n>, Case postale,
  General Delivery — regexes in `config/rules.json`): Canada Post gets the full
  address + "PO Box → CP" badge; UPS/OT get the address with the PO Box
  stripped if a street address remains, otherwise the row says
  "PO Box only — Canada Post only".
- **Signature required** checkbox: UPS = Adult Signature Required,
  Canada Post = Signature, OT = not offered (null in config).
- **Field mapping** (`config/carrier_fields.json`): UPS name = company ||
  customer, attention = customer, no reference; Canada Post name = customer,
  company = company, reference = order number; OT like Canada Post. Email and
  phone go to every carrier. The quotes section has a collapsible "What each
  courier will receive" panel showing the mapped values.
- **Courier history**: "Usually ships with X (n of N)" + "Usual" badge on that
  carrier's row (never used for residential/commercial).

## Setup page — "Setup — what we need" (`/app/setup`)

Checklist with status pills (Done / Waiting / Not started / Later), who
provides each item, why, and where it goes. Auto-detected: granted scopes,
carrier env vars (names only — values are never displayed), Shopify Locations
(ship-from; staff confirm one → stored in `Setting`), `config/boxes.json`
(`_placeholder: true` = not started), address-check keys. Manual items (staff
account, owner approval, OT) have Mark done / Mark waiting buttons stored in
`Setting`. "Print this checklist" opens a clean printable page. Every env var
is listed with comments in `.env.example`.

### Protected customer data (required for name/address/email/phone)

Shopify hides these fields unless the app has protected customer data access.
Setup for this single-store custom app:

1. Shopify Dev Dashboard (or Partner Dashboard) → this app → **API access** →
   **Protected customer data access** → Request access.
2. Select **Protected customer data**, then the fields **Name, Email, Phone,
   Address**. Reason for each: "Shipping orders — create labels and carrier
   notifications".
3. Fill in the data-protection questions (we store only what shipping needs;
   no addresses in logs; data stays in our Railway DB).
4. Save, then reinstall/re-auth the app on the store if Shopify asks
   (`npm run deploy` pushes the scope change; open the app to accept it).
5. Check: an order on the shipment screen shows name, address, email and
   phone instead of blanks.

### Customer courier history (information only)

`app/lib/history.server.ts` reads the customer's last 10 orders and each
order's latest fulfillment `trackingInfo { company number }`. Our own
`Shipment` rows (written when the app books, Phase 2+) win over Shopify's
free-text tracking company. Blank / "Other" → "Unknown". Shown as "First-time
customer" or "N previous orders · Usually ships with: X (x of N)" plus the
last shipment (courier, date, order number). The quotes list marks the
customer's usual courier with a "Usual" badge.

- History **never** sets or suggests residential/commercial.
- We do **not** request `read_all_orders`, so Shopify only returns roughly the
  last **60 days** of orders; older history is invisible.

## Entry point

Staff start from the **Shopify order page → More actions → "Ship with Ship
Desk"** — an admin action extension (`extensions/ship-desk-action`, target
`admin.order-details.action.render`), the same way OT's own action works. The
modal shows ship-to, GTA/Non-GTA, the address check + Residential/Commercial,
then either "Print in OT" (GTA + residential) or box entry + Get quotes. For
big multi-piece orders it offers "Open full screen" → `/app/ship/:id`. The
"Orders to ship" list page is secondary. Phase 5 adds an orders-index selection
action for bulk shipping.

The modal talks to `/api/ship/:id` (JSON; `authenticate.admin` + `cors`), which
runs the same code as the full page (`app/lib/shipping.server.ts`).

## Layout

```
config/
  gta_fsa.json      GTA definition: "prefixes" (e.g. all of M) + "fsas" grouped by region
  boxes.json        Box presets (cm / kg) shown as one-click buttons
  ot.json           OT order-page URL template (TBD after recon)
  rules.json        PO Box patterns, GTA-residential carrier
  carrier_fields.json  Per-carrier field mapping, PO Box handling, signature, required env
carriers/
  types.ts          CarrierAdapter interface + Box, Quote, Booking, Label, AddressType
  index.ts          Registry: carriers[] (UPS, Canada Post, OT), getCarrier(), carrierForQuote(), carrierNeeds()
  env.ts            missingEnv / hasAllEnv / NotImplementedError (names only, never values)
  ups.ts, canadapost.ts, ot.ts   Adapter stubs: connected = env present; quoting not built
  sample.ts         "Preview with sample prices" quotes (local, sample: true)
extensions/
  ship-desk-action/ Order-page action (Preact + admin web components, own tsconfig)
app/
  lib/gta.ts        fsaOf(), zoneFor() — pure, safe on client and server
  lib/boxes.ts      presets, parseBoxes() (sanitizes form input), MAX_BOXES = 99
  lib/ot.ts         otOrderUrl() from config/ot.json
  lib/orders.server.ts   Admin GraphQL (queries only): listUnfulfilledOrders, getOrder
  lib/shipping.server.ts loadShipment / handleShipment — shared by page + API
  lib/history.server.ts  Customer courier history (last 10 orders + our Shipment rows)
  lib/courier.ts         normalizeCourier, isUsualCourier, historySummary (browser-safe)
  components/TestModeBanner.tsx  Yellow read-only banner (every page)
  components/CarrierQuotes.tsx   Carrier rows, quotes, Print/Preview, "What each courier will receive"
  lib/rules.ts (+ rules.test.ts) Routing, PO Box, signature, field mapping
  lib/quotes.server.ts   carrierRows / quoteRows (status, sample quotes, adapter calls)
  lib/carrierRows.ts     CarrierRow type (browser-safe)
  lib/sampleLabel.ts     4x6 sample labels, watermarked "SAMPLE — NOT A REAL LABEL"
  lib/locations.server.ts  Ship-from from Shopify Locations
  lib/settings.server.ts   Per-shop key/value (Setting table)
  lib/setup.ts / setup.server.ts  Setup checklist + printable view
  routes/app.setup.tsx   "Setup — what we need"
  lib/classifier/        Address classifier (search.server, judge.server, index.server, types)
  components/AddressCheckPanel.tsx  Verdict + evidence + Confirm (full page)
  routes/app._index.tsx  Orders to ship (list, GTA filter) — secondary entry point
  routes/app.ship.$id.tsx  Shipment screen for one order (id = numeric order id)
  routes/api.ship.$id.tsx  JSON API for the order-page extension
prisma/schema.prisma  Session (Shopify), ShipmentDraft (per-order boxes/address type),
                      AddressCheck (classifier cache + last staff confirmation),
                      Shipment (bookings made by the app; courier history source),
                      Setting (setup checklist state, confirmed ship-from location)
```

## Data flow (shipment screen)

1. Loader fetches the order from Shopify + any `ShipmentDraft`.
2. "Check address automatically" runs the classifier (cached per address).
   Staff see verdict + reason + evidence links and must click **Confirm** (or
   pick Residential/Commercial themselves). "Unsure" → contact the customer.
   The Google / Maps buttons stay for manual checks. Nothing is decided or
   booked without a staff click.
3. GTA + Residential → "Open in OT to print labels". Nothing else to enter.
4. Otherwise → box table (presets, custom, Duplicate ×N, remove), Signature
   required, Preview with sample prices → "Get quotes" (or Enter in a box
   field on the full page). The action upserts the draft, validates, then
   builds one row per carrier with `quoteRows()`.

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
- An adapter that throws must not break the others (`quoteRows` turns it into an "error" row).
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

## Address classifier (Phase 3 — built, runs on mocks until keys exist)

Mirrors the manual process (`app/lib/classifier/`):

1. Search the full address **including the unit** — `SearchProvider`
   interface; live = Brave Search API (`BRAVE_SEARCH_API_KEY`). Google Custom
   Search is closed to new customers.
2. Claude (`ANTHROPIC_API_KEY`, model `CLASSIFIER_MODEL`, default
   `claude-opus-5-5`, effort low, structured output, server-side refusal
   fallback) reads the results.
3. If a business name recurs, a second search `"<business>" <city>` confirms
   whether it is really at this address, then Claude judges again.
4. Home evidence (realtor.ca / condo / rental listings, unit in a residential
   tower) → residential.
5. Output `{verdict: residential|commercial|unsure, confidence, reason (1 line),
   evidence: [{title, url, snippet}] ≤ 5}`, cached in `AddressCheck` per
   normalized address (+ the last staff confirmation). "Check again" bypasses
   the cache.

Without keys the address check is "Not connected". For development only,
`CLASSIFIER_DEMO=1` enables the built-in mock search + mock judge ("Demo
data"): Unit/#/Apt → residential, Suite or Plaza/Industrial/Blvd → commercial
(via the second search), anything else → unsure.

## Phases

1. **Foundation (done, read-only presentation build)** — setup checklist,
   carrier rows with "Not connected — needs …", sample quotes + sample labels,
   PO Box / signature / field-mapping rules, unfulfilled order list,
   GTA/Non-GTA zoning from FSA list, order data incl. email + courier history,
   shipment screen with boxes, presets, Duplicate ×N,
   Residential/Commercial, "Open in OT" step for GTA residential, carrier
   interface + mock quotes, saved drafts, **order-page action entry point**.
2. **OT automation** — recon, choose Playwright vs Chrome extension, implement
   `carriers/ot.ts` (quotes from OT sub-couriers, book, OT labels for all
   boxes), write `Shipment` rows on booking (carrier name feeds courier
   history), create the Shopify fulfillment with tracking numbers (needs
   fulfillment write scopes — ends test mode). Fill in the OT URL pattern.
3. **Address classifier (built, mock mode)** — web search + Claude suggest
   Residential/Commercial/Unsure with evidence; staff confirm. Goes live when
   `BRAVE_SEARCH_API_KEY` and `ANTHROPIC_API_KEY` are set.
4. **UPS, Canada Post, FedEx** — official API adapters (sandbox first), quotes
   side by side with OT, book + labels + tracking, preferred-carrier rules.
5. **Daily workflow + hardening** — orders-index selection action
   (`admin.order-index.selection-action.render`) for bulk shipping, pickups
   and end-of-day manifests, void/re-print, packing slips; shipping cost vs.
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
- Customer data is PII: never log addresses, names, emails or phone numbers
  (log error types/status codes only), and no PII in URLs we control. They
  go only to: the carrier being quoted, Brave Search + the Claude API (address
  classifier, staff-triggered), and Google lookups the staff member clicks.
- Secrets/API keys only via env vars (Railway variables), never in code or config/.

## Commands

- `npm run dev` — `shopify app dev` (tunnel + install on dev store)
- `npm run typecheck` (app + extension), `npm run lint`, `npm test` (rules), `npm run build`
- `npm run deploy` — push `shopify.app.toml` (scopes, URLs, webhooks) to Shopify
