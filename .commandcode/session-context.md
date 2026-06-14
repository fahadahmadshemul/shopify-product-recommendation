# Session Context — Product Recommendation System

> Full project reference. Last updated: 2026-06-14

---

## Project Overview

Shopify embedded app that injects personalized product recommendation widgets on storefront product pages. Tracks visitor activity (view/cart/purchase), serves recommendations via collaborative filtering with event-weighted scoring and recency decay.

| | |
|---|---|
| **Framework** | React Router v7 (SSR), `flatRoutes()` file-based routing |
| **Database** | Prisma ORM + SQLite (`dev.sqlite`) |
| **Platform** | Shopify Embedded App (App Store distribution) |
| **API Version** | 2025-10 |
| **Node** | `>=20.19 <22 \|\| >=22.12` |

---

## Database Schema (`prisma/schema.prisma`)

**6 Models:**

| Model | Purpose | Key Fields |
|---|---|---|
| **Session** | Shopify OAuth sessions | `id`, `shop`, `accessToken`, `scope`, `refreshToken` |
| **Shop** | Merchant store record | `id` (autoinc), `shop` (unique), `isActive`, `currency`, `accessToken` |
| **Product** | Synced product cache | `id` (gid://), `title`, `handle`, `price`, `compareAtPrice`, `imageUrl`, `firstVariantId`, `shopDomain` |
| **VisitorActivity** | Visitor behavior events | `visitorId`, `shopDomain`, `productId`, `eventType` (view/cart/purchase), `duration` |
| **Recommendation** | Generated recommendation log | `visitorId`, `shopDomain`, `productId`, `score` |
| **BillingSubscription** | Payment subscriptions | `shopId` (FK), `shopifySubscriptionId`, `planKey`, `status` |

**Indexes:** `Product(shopDomain)`, `VisitorActivity(shopDomain, productId)`, `VisitorActivity(shopDomain, visitorId)`, `Recommendation(shopDomain, createdAt)`

**7 Migrations** in `prisma/migrations/`

---

## Billing Plans

| Plan | Products | Recommendations/Month | Price |
|---|---|---|---|
| **Free** | 2 | 10 | $0 |
| **Basic** | 7 | 15 | $7.99/mo (7-day trial) |
| **Pro** | Unlimited | Unlimited | $13.99/mo (7-day trial) |

Plan definitions in `app/services/billing.service.js`. Limit enforcement in `app/services/recommendation-limit.service.js`.

---

## Route Map

### Auth
| Route | File | Purpose |
|---|---|---|
| `/auth/login` | `app/routes/auth.login/route.jsx` | Shop domain input form |
| `/auth/*` | `app/routes/auth.$.jsx` | OAuth catch-all — triggers Shopify OAuth |
| `/` | `app/routes/_index/route.jsx` | Landing page / login redirect |

### Admin Dashboard (Embedded App)
| Route | File | Purpose |
|---|---|---|
| `/app` (layout) | `app/routes/app.jsx` | Embedded shell: App Bridge, Polaris, nav bar |
| `/app/_index` | `app/routes/app._index.jsx` | Analytics: views/carts/purchases, CTR, top 5 products, 7-day chart, limit warnings |
| `/app/products` | `app/routes/app.products.jsx` | Product sync/add/delete UI, IndexTable, App Bridge resource picker, plan limit bar |
| `/app/billing` | `app/routes/app.billing.jsx` | 3-column plan cards, upgrade/downgrade |
| `/app/billing/subscribe` | `app/routes/app.billing.subscribe.jsx` | Handles plan change → billing.request() |
| `/app/billing/success` | `app/routes/app.billing.success.jsx` | Post-payment confirmation |

### Public API (Storefront — App Proxy HMAC)
| Route | File | Method | Purpose |
|---|---|---|---|
| `/api/track` | `app/routes/api.track.jsx` | POST | Receives visitor activity, saves to DB, auto-syncs missing products (background) |
| `/api/recommendations` | `app/routes/api.recommendations.jsx` | GET | Recommendation engine: collaborative filtering → response with products + scores |
| `/api/gdpr` | `app/routes/api.gdpr.jsx` | GET/DELETE | Manual data export/erasure by visitorId |

### Webhooks (Shopify → App)
| Route | File | Topic |
|---|---|---|
| `/webhooks/app/uninstalled` | `app/routes/webhooks.app.uninstalled.jsx` | `APP_UNINSTALLED` — deactivates shop, clears token |
| `/webhooks/app/scopes_update` | `app/routes/webhooks.app.scopes_update.jsx` | `APP_SCOPES_UPDATE` |
| `/webhooks/gdpr/$topic` | `app/routes/webhooks.gdpr.$topic.jsx` | `CUSTOMERS_DATA_REQUEST`, `CUSTOMERS_REDACT`, `SHOP_REDACT` |
| *(in shopify.server.js)* | `app/shopify.server.js` | `APP_SUBSCRIPTIONS_UPDATE` — syncs subscription status to DB |

---

## Recommendation Algorithm

**Location:** `app/routes/api.recommendations.jsx`

### Flow:
1. **Limit check** — monthly recommendation count vs plan limit
2. **Collaborative filtering** — find visitors who viewed current product → get their other events
3. **Event-weighted scoring:**
   - Purchase = 5×, Cart = 3×, View = 1×
   - Recency decay: `exp(-ln(2)/14 * daysAgo)` (14-day half-life)
4. **Score Map** — sum `eventWeight × recencyFactor` per product → top 4 by score
5. **Activity fallback** — if < 4 recs, top store-wide products (same scoring)
6. **Cold-start fallback** — if still empty, newest products from cache → `coldStart: true`
7. **Handle backfill** — batch `nodes(ids: [...])` GraphQL query for any null handles
8. **Log impressions** — writes to `Recommendation` table

### Response fields:
`recommendations[]` (id, title, handle, price, compareAtPrice, imageUrl, firstVariantId, score), `shopCurrency`, `coldStart`, `limitUsage`

---

## Storefront Widget (`extensions/visitor-tracker/assets/tracker.js`)

Vanilla JS, ~500 lines. Runs on storefront product pages.

### Features:
- **Visitor ID:** Generated once, stored in localStorage (`v_` + random + timestamp)
- **Product page detection:** `window.ShopifyAnalytics.meta.product.id`
- **View tracking:** POST on page load + duration on `beforeunload`
- **Cart tracking:** Click listener on `[name="add"]`, `.add-to-cart`, etc.
- **Purchase tracking:** `Shopify.Checkout.step === "thank_you"` → iterates line items
- **Recommendation fetch:** GET `/api/recommendations` → renders widget

### Widget rendering:
- **3 heading states:** "Recommended for You" / "Popular Products" (cold start) / "Coming Soon" (empty)
- **Card design:** 2-col mobile, 4-col desktop grid. Image, title, price row, ATC button
- **Sale badge:** Red badge top-left when `compareAtPrice > price`
- **ATC button:** POSTs `/cart/add.js` with variant ID. Loading spinner → "✓ Added" → tracks cart event
- **Dark mode:** Full `@media (prefers-color-scheme: dark)` support
- **Currency:** Uses `Intl.NumberFormat` with `shopCurrency` from API (no hardcoded `$`)
- **Smart insertion:** After `.product`, `.product-single`, `#MainContent`, or `<main>`

### GDPR Consent:
- Opt-out banner on first visit ("This site uses analytics…")
- Accept → enables tracking. Decline → purges server data + clears localStorage
- `getConsent()` gate at top of IIFE — if declined, entire tracker exits

---

## Services Layer

| File | Purpose |
|---|---|
| `app/services/billing.service.js` | Plan definitions (keys, limits, names), `buildShopifyBillingConfig()` |
| `app/services/recommendation-limit.service.js` | Resolves active plan, counts monthly recs, returns `{ allowed, limit, used, remaining }` |
| `app/services/products.server.js` | Shopify GraphQL product sync: `syncProducts()` (50), `syncProductsWithLimit()` (plan-aware) |
| `app/services/tracker.server.js` | `saveActivity()` — creates VisitorActivity row |
| `app/services/shop.server.js` | `saveShopToDb()` — upserts shop record after OAuth |
| `app/services/tenant.service.js` | `resolveTenant()` — upserts Shop, returns `{ id }` for FK use |
| `app/services/rate-limiter.server.js` | In-memory sliding window. Per visitorId + IP. Auto-cleanup 60s. |
| `app/repositories/shops.repository.js` | **Unused** — references wrong schema fields (shopDomain, uninstalledAt). Not wired in. |

---

## Full Audit Summary — All Improvements

### Verified Correct (prior sessions):
- ✅ Tenant isolation — every DB query scoped by `shopDomain`
- ✅ Limit enforcement — `checkRecommendationLimit()` uses calendar-month count
- ✅ Collaborative filtering — event-weighted (5/3/1) + 14-day exponential decay
- ✅ Dark mode + lazy loading in tracker.js
- ✅ Currency formatting — `Intl.NumberFormat` with real `shopCurrency` (no hardcoded `$` in widget or admin)
- ✅ Uninstall webhook — deactivates shop, clears token, deletes session. Full purge in GDPR handler
- ✅ GDPR handler — all 3 topics: data_request, customers_redact, shop_redact

### Improvements Implemented (2026-06-14 — Today):

| # | Issue | Fix |
|---|---|---|
| 6 | **Sequential handle fetches** — N GraphQL calls for N products with null handles | **Batched `nodes(ids: [...])`** single query, handleMap distribution |
| 7 | **Title-to-slug fallback** generated wrong URLs (404) | **`rec.handle ? /products/${rec.handle} : "#"`** — safe fallback |
| 8 | **Cold start silent failure** — no products, no user message | **3-state rendering:** Popular Products / Recommended for You / Coming Soon with empty message |
| 9 | **No rate limiting** — bot could exhaust monthly limit | **In-memory sliding window:** 30/min (recs), 60/min (track). Per visitorId+IP |
| 10 | **Generic "Server error"** masked actual errors | **`error.message \|\| "Server error"`** in all 4 catch blocks |
| 13 | **Blocking auto-sync** delayed track endpoint response | **Fire-and-forget `syncProductInBackground()`** — no `await` |
| dev | **`npm run dev` crash** — missing locales dir + invalid GDPR topics | **Created `locales/en.default.json`**, removed GDPR topics from `shopify.app.toml` |

### Earlier Fixes (2026-06-14 — Bug Fix session):
- **Prisma Generate EPERM** (Windows) — rename locked `.dll.node` before re-running
- **Shopify GraphQL field error** — `minVariantPrice` → `minVariantCompareAtPrice` in `compareAtPriceRange`
- **Database indexes** added for performance
- **Schema:** Added `firstVariantId` to Product model
- **Product sync:** Added `compareAtPrice` + `firstVariantId` + `handle` to sync + auto-sync
- **Card redesign:** ATC button, SALE badge, strikethrough compare-at price

---

## Data Flow (End-to-End)

```
1. Visitor lands on product page
   → tracker.js loads, generates visitorId, POST /api/track (view)

2. Tracker.js fetches GET /api/recommendations?productId=X&visitorId=Y
   → Limit check → Collaborative filtering → Score → Fallback → Cold start
   → Batch handle fetch → Log impressions → Return JSON

3. Widget renders with cards, prices, sale badges, ATC buttons

4. Visitor clicks ATC button
   → POST /cart/add.js → POST /api/track (cart)

5. Visitor completes purchase (thank-you page)
   → tracker.js detects step=thank_you → POST /api/track (purchase) × each item
```

---

## Key Architectural Decisions

- **SQLite** — single-file DB, no separate DB server needed. Enforces tenant isolation via WHERE clauses
- **Vanilla JS widget** — no React on storefront. Minimal JS footprint, no framework dependency
- **App Proxy auth** — all public API endpoints authenticated via HMAC, not API keys
- **In-memory rate limiter** — no Redis dependency. Adequate for single-server deployment
- **Calendar-month billing** — recommendation count resets on 1st of each month
- **Fire-and-forget sync** — product sync from Shopify happens in background, doesn't block API responses
- **No extracted components** — all Polaris UI code inline in route files (components/ dirs exist but empty)
