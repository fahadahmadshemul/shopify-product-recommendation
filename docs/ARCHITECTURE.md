# Product Recommendation System — Architecture & Knowledge Base

> Auto-generated: 2026-06-28 — regenerated from current code after prompts 1–11

## Tech Stack

- **Framework:** React Router v7 (file-based flat routing, SSR)
- **Database:** Prisma ORM + SQLite (`prisma/dev.sqlite`)
- **UI:** Shopify Polaris + App Bridge React
- **Platform:** Shopify Embedded App (App Store distribution)
- **Storefront:** Theme App Extension (Liquid + JS tracker)

---

## Database Schema (6 models)

| Model | Purpose | Key Fields |
|---|---|---|
| `Session` | Shopify OAuth sessions | `id`, `shop`, `accessToken`, `scope`, `expires` |
| `Shop` | Merchant store record | `id` (autoincrement), `shop` (unique), `accessToken?` (nullable after uninstall), `isActive`, `currency`, `widgetSettings` |
| `Product` | Synced product cache | `id` (gid://shopify/Product/\d+), `title`, `handle?`, `price`, `compareAtPrice?`, `imageUrl?`, `firstVariantId?`, `shopDomain` |
| `VisitorActivity` | User behavior tracking | `visitorId`, `customerId?` (Shopify customer ID when logged in), `shopDomain`, `productId`, `eventType` (view/cart/purchase), `duration?`, `price?` |
| `Recommendation` | Impression log | `visitorId`, `shopDomain`, `productId`, `score`, `createdAt` |
| `BillingSubscription` | Plan subscription state | `id` (cuid), `shopId` → Shop, `shopifySubscriptionId?`, `planKey`, `status`, `trialEndsAt?`, `currentPeriodEndsAt?` |

> **Note:** `Shop.accessToken` is `String?` (nullable). It is set to `null` when a merchant uninstalls the app via the `APP_UNINSTALLED` webhook, since the token is no longer valid.

> **Note:** `VisitorActivity.customerId` is nullable — it is only populated when the storefront tracker can read `window.ShopifyAnalytics.meta.page.customerId` (i.e. logged-in customers). Anonymous sessions have `null`.

---

## Billing Plans (3 tiers)

Defined in [`app/services/billing.service.js`](../app/services/billing.service.js).

| Plan | Products | Rec Impressions/mo | Analytics | Trial | Price |
|---|---|---|---|---|---|
| FREE | 50 | 500 | No | None | $0 |
| BASIC | 1,000 | 25,000 | No | 14 days | $9.99/mo |
| PRO | Unlimited (null) | Unlimited (null) | Yes | 14 days | $39.99/mo |

**PRO plan scoring boost:** The PRO plan receives a **1.5× priority multiplier** applied to all recommendation event scores, producing higher-quality ordering for merchants on the top tier.

### Plan Resolution (Single Source of Truth)

All code resolves the active plan via `resolveActivePlan(shopDomain, billing)` in [`app/services/billing.service.js`](../app/services/billing.service.js):

1. When a Shopify `billing` object is available (admin routes), calls Shopify's live `billing.check()` as source of truth.
2. **Self-healing cache:** On every successful `billing.check()`, upserts the local `BillingSubscription` row to stay in sync — eliminating stale-cache bugs.
3. **Graceful fallback:** If `billing.check()` throws (transient network issue) or no `billing` object is provided (storefront/public routes), reads from the local `BillingSubscription` table instead of hard-failing.

---

## Key Service Files

| File | Purpose |
|---|---|
| `app/services/billing.service.js` | Plan definitions, `resolveActivePlan()` (single source of truth), helpers (`getPlan`, `getPlanByName`, `buildShopifyBillingConfig`) |
| `app/services/recommendation-limit.service.js` | Monthly recommendation limit enforcement — delegates to `resolveActivePlan()`, provides `checkRecommendationLimit()`, `getActivePlanKey()`, `getActivePlan()` |
| `app/services/products.server.js` | Cursor-paginated product sync from Shopify GraphQL (`syncProducts`, `syncProductsWithLimit`). Both loop over pages with `after: $cursor` until all pages exhausted or plan limit reached. |
| `app/services/tracker.server.js` | Visitor activity persistence (`saveActivity`) |
| `app/services/shop.server.js` | Shop registration on OAuth (`saveShopToDb`) |
| `app/services/tenant.service.js` | Tenant resolution — upserts `Shop` row before billing writes (`resolveTenant`) |
| `app/utils/visitor-token.server.js` | HMAC-signed visitor token sign/verify utilities for securing `/api/gdpr` |

> **Note:** `app/repositories/shops.repository.js` was **deleted** — it referenced schema fields (`shopDomain`, `uninstalledAt`, `storefrontExpiryEnabled`) that don't exist in the Prisma schema, and was not imported anywhere in the codebase.

---

## Route Files

| Route | File | Purpose |
|---|---|---|
| `/auth/login` | `auth.login/route.jsx` | Login form |
| `/auth/*` | `auth.$.jsx` | OAuth catch-all |
| `/app` | `app.jsx` | Layout — App Bridge + Polaris provider + nav bar |
| `/app/_index` | `app._index.jsx` | Dashboard — analytics, metrics, rec limit banner/card |
| `/app/products` | `app.products.jsx` | Product manager — sync/add/delete with plan-limit enforcement |
| `/app/billing` | `app.billing.jsx` | 3-column plan cards, upgrade/downgrade UI |
| `/app/billing/subscribe` | `app.billing.subscribe.jsx` | POST action → `billing.request()` → redirects to `/app/billing/success` |
| `/app/billing/success` | `app.billing.success.jsx` | Post-payment landing page — calls `resolveActivePlan` which self-heals local subscription record |
| `/api/track` | `api.track.jsx` | Public storefront tracking endpoint (POST via App Proxy). Validates `eventType`, `productId` (GID format), `duration` (0–86400s), `price` (≥0). Sets HMAC-signed `visitorToken` in response. |
| `/api/recommendations` | `api.recommendations.jsx` | Recommendation engine + limit enforcement (GET via App Proxy) |
| `/api/gdpr` | `api.gdpr.jsx` | GDPR data export (GET) and erasure (DELETE) — requires `visitorToken` query param for authorization |
| `/api/webhooks` | `api.webhooks.jsx` | `APP_SUBSCRIPTIONS_UPDATE` webhook — syncs subscription status to local DB |
| `/webhooks/orders/paid` | `webhooks.orders.paid.jsx` | `orders/paid` webhook — extracts `_vt_visitor_id` from cart attributes, saves `purchase` activity events |
| `/webhooks/gdpr/:topic` | `webhooks.gdpr.$topic.jsx` | `CUSTOMERS_DATA_REQUEST` / `CUSTOMERS_REDACT` — matches by `customerId` (not anonymous `visitorId`) |
| `/webhooks/app/uninstalled` | `webhooks.app.uninstalled.jsx` | Deletes sessions, sets `isActive: false`, nulls `accessToken` on uninstall |
| `/webhooks/app/scopes_update` | `webhooks.app.scopes_update.jsx` | Updates session scope |

---

## Recommendation Algorithm

Implemented in [`app/routes/api.recommendations.jsx`](../app/routes/api.recommendations.jsx).

### Scoring Formula

```
score(event) = eventWeight × recencyFactor × priorityBoost

where:
  eventWeight = { purchase: 5, cart: 3, view: 1 }[eventType]  (defaults to 1)
  recencyFactor = exp(−(ln2 / 14) × daysAgo)  // 14-day half-life exponential decay
  priorityBoost = 1.5  (PRO plan only)  |  1.0  (FREE / BASIC)
```

The scoring logic is extracted into an **exported** `scoreEvents(events, now, planKey)` function, enabling unit testing in isolation.

### Full Algorithm Steps

1. **Co-visitor lookup:** Find other visitors who interacted with the current product (up to 200 distinct visitor IDs).
2. **Co-occurrence scoring:** Fetch all activity events from those visitors for *other* products (up to 2,000 events), apply the scoring formula above, accumulate per product.
3. **Sort & select:** Sort products by accumulated score descending, take top `min(4, remaining_monthly_allowance)`.
4. **Fallback to global engagement:** If fewer than `maxRecs` recommendations found, fill remaining slots from top-scoring products store-wide (up to 1,000 events, same scoring formula).
5. **Cold-start:** If zero recommendations (no activity data anywhere), fall back to the most recently synced products.
6. **Product detail fetch:** Retrieve product rows from the cached `Product` table. On-the-fly fix any missing `handle` fields via Shopify GraphQL batch query.
7. **Impression logging:** Write all served recommendations to the `Recommendation` table for monthly usage counting and conversion analytics.

### Monthly Limit Enforcement

- `checkRecommendationLimit(shopDomain)` is called before any computation.
- If monthly limit exceeded → returns `{ recommendations: [], limitReached: true, message: "..." }`.
- Limit is counted from `Recommendation.createdAt` per calendar month.

---

## Storefront Extension (`extensions/visitor-tracker/`)

- **`assets/tracker.js`** — Full client-side JS:
  - Generates anonymous `visitorId` (`v_` + random + timestamp), stored in `localStorage`.
  - Sends `customerId` (from `window.ShopifyAnalytics.meta.page.customerId`) when visitor is logged in.
  - Stores server-issued HMAC-signed `visitorToken` in `localStorage` (received on each `/api/track` response) and sends it on `/api/gdpr` calls for server-side ownership verification.
  - Tracks `view`, `cart`, and `purchase` events via POST to `/api/track`.
  - Sets `_vt_visitor_id` cart attribute via `/cart/update.js` so it flows into order data for the `orders/paid` webhook.
  - Fetches recommendations from `/api/recommendations`, renders "Recommended for You" widget as CSS grid.
  - Renders cookie consent banner (opt-out model). On opt-out, calls DELETE `/api/gdpr?visitorId=…&visitorToken=…` and wipes localStorage.
- **`blocks/visitor_tracker.liquid`** — Liquid block injected into theme.

---

## Security Notes

### Public Endpoint Protection
- **`/api/track`**: Authenticated via Shopify App Proxy HMAC signature. Input validated: `eventType` (view/cart/purchase only), `productId` (GID regex), `duration` (0–86400s), `price` (≥0). Rate limited to 60 req/min per visitor. GraphQL uses parameterized variables (no interpolation).
- **`/api/gdpr`**: Requires `visitorToken` query param — an HMAC-SHA256 signature of the `visitorId` using `SHOPIFY_API_SECRET`. Prevents enumeration attacks (predictable visitorId format). See `app/utils/visitor-token.server.js`.
- **`/api/recommendations`**: Rate limited to 30 req/min per visitor.

### Why No httpOnly Cookies for Visitor Binding
The tracker runs on the merchant's storefront (`*.myshopify.com`) — a different domain than the app backend. This cross-domain context means `Set-Cookie` from an App Proxy response never reaches the browser. Safari ITP and Chrome's third-party cookie phase-out both block it. Shopify's own guidelines prohibit reliance on third-party cookies. The HMAC-token-in-localStorage approach is the correct pattern for this context.

### GDPR Webhooks
- `CUSTOMERS_DATA_REQUEST` / `CUSTOMERS_REDACT` match records by **`customerId`** (Shopify's customer ID), not the anonymous `visitorId` string.
- Anonymous sessions (null `customerId`) are correctly skipped — they cannot be linked to a Shopify customer identity.
- These webhooks must be registered manually in the Shopify Partners Dashboard (not in `shopify.app.toml` to avoid CLI conflicts).

---

## Key Architectural Notes

1. **Product ID format:** `gid://shopify/Product/{numeric_id}` — enforced by regex on all public inputs.
2. **Product sync is cursor-paginated:** Both `syncProducts` and `syncProductsWithLimit` loop with `after: $cursor` until `pageInfo.hasNextPage` is false or the plan cap is hit. Page size is 50 to avoid timeout risk.
3. **`syncProductInBackground` in `/api/track`** uses `db.product.upsert` (not `create`) to handle concurrent requests for the same new product without unique-key constraint errors.
4. **All billing plan resolution** goes through `resolveActivePlan()`. Do not call `billing.check()` directly in routes — it bypasses the self-healing cache write.
5. **Shop.accessToken is nullable** (String?) — set to `null` on uninstall. Code that reads `accessToken` must handle `null`.
6. **Automated tests:** Vitest test suite at `tests/` covers scoring weights, recency decay, PRO boost, recommendation limit enforcement (FREE/BASIC/PRO tiers), and product sync pagination behavior.
