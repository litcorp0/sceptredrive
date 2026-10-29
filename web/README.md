# Sceptre Drive — website

The public site. A TanStack Start app in the root Bun workspace; it shares
`@sceptre/brand` (colour, type, fonts) and `@sceptre/shared` (the `SiteContent`
contract) with the console and the POS.

**Purpose:** the business's online presence — for Paystack onboarding and for
customers who want to see what we stock and where to find us. **Not a shop:**
there is no cart, checkout, price, stock, online payment or customer account
here. Parts are supplied at the counter.

## Run it

```bash
bun install                 # from the repository root, one lockfile
bun run dev:web             # http://localhost:3004
```

The API must be running for live content (`bun run dev:api`). If it is not, the
site renders the bundled fallback in `src/lib/site-fallback.ts` — that is
deliberate, not a bug.

## Where the content comes from

`GET /api/public/site` (the `api/src/modules/site` module) reads the `web.*`
settings and the active retail branches. An administrator edits those in
**Admin → Settings → Website**; the site caches for 5 seconds in development and
60 seconds in production.

`WEB_API_URL` is server-only and defaults to `http://localhost:4000`.
`VITE_SITE_URL` is the canonical origin used by the sitemap and social metadata;
set it when the real domain exists. Both are documented in `.env.example`.

## Routes

| Route | What it is |
|---|---|
| `/` | Hero, range index, how the counter works, workshop band, branches, CTA |
| `/parts` | Searchable index of the six ranges — lubricants, batteries, belts, filters, spark plugs, light bulbs (`?q=` is shareable) |
| `/services` | Counter supply, trade accounts, sourcing and range advice |
| `/branches` | Address, hours, phone and directions for every retail branch |
| `/about` | The business story and the three standards |
| `/contact` | Call, WhatsApp, email and visit — no fake form |
| `/shop` | The honest "no online sales" page and the future store seam |
| `/sitemap.xml`, `/robots.txt` | Generated server routes |

## Design

"The Counter Ticket": charcoal ink, warm paper, one orange accent, Space Grotesk
for display, Inter for body and JetBrains Mono for codes. The signature is the
till-ticket artifact in the hero, with a CSS perforated edge and a barcode strip.
One orchestrated load (the speed line draws, the ticket prints); every motion is
disabled under `prefers-reduced-motion`.

Colour and type come from `@sceptre/brand` only. `bun run tokens:check` scans
`web/src` and fails on a brand hex.

## Tests and gates

```bash
bun run --filter web check-types
bun run --filter web lint
bun run --filter web test      # content guard, loader fallback, links, index
bun run --filter web build
```

Photography and its licences are in [CREDITS.md](./CREDITS.md).
