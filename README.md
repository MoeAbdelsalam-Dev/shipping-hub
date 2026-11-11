# shipping-hub

Ship Desk — embedded Shopify admin app for our store's shipping workflow:
unfulfilled orders, GTA / Non-GTA zoning, residential vs commercial, multi-box
shipments, carrier quotes (OT, UPS, Canada Post, FedEx). Hosted on Railway.

See [CLAUDE.md](CLAUDE.md) for architecture, phases and conventions.

## Local development

Requires Node >= 22.15 and the Shopify CLI (`npm i -g @shopify/cli`).

```bash
cp .env.example .env
npm install
npm run dev
```

Checks: `npm run typecheck`, `npm run lint`, `npm run build`.
