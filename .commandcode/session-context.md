# Session Context — Product Recommendation System

> Full project reference. Last updated: 2026-06-15

---

## Project Overview

Shopify embedded app that injects personalized product recommendation widgets on storefront product pages. Tracks visitor activity (view/cart/purchase), serves recommendations via collaborative filtering with event-weighted scoring and recency decay.

| | |
|---|---|
| **Framework** | React Router v7 (SSR), `flatRoutes()` file-based routing |
| **Database** | Prisma ORM + SQLite (`prisma/dev.sqlite`) |
| **Platform** | Shopify Embedded App (App Store distribution) |
| **Distribution ID** | `3944602` / App ID `371336806401` |
| **API Version** | 2025-10 |
| **Node** | `>=20.19 <22 \|\| >=22.12` |
| **Scopes** | `read_products` |

---

## Database Schema (`prisma/schema.prisma`)

**6 Models:**

| Model | Purpose | Key Fields |
|---|---|---|
| **Session** | Shopify OAuth sessions | `id`, `shop`, `accessToken`, `scope`, `refreshToken` |
| **Shop** | Merchant store record | `id` (autoinc), `shop` (unique), `isActive`, `currency`, `accessToken` |
| **Product** | Synced product cache | `id` (gid://), `title`, `handle`, `price`, `compareAtPrice`, `imageUrl`, `firstVariantId` (numeric), `shopDomain` |
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

**Important:** `SHOPIFY_BILLING_TEST=true` in `.env` — set to `false` before production deploy for real charges.

---

## Route Map

### Auth
| Route | File | Purpose |
|---|---|---|
| `/auth/login` | `app/routes/auth.login/route.jsx` | Shop domain input form |
| `/auth/*` | `app/routes/auth.$.jsx` | OAuth catch-all — triggers Shopify OAuth |
| `/` | `app/routes/_index/route.jsx` | Landing page with app branding |

### Admin Dashboard (Embedded App)
| Route | File | Purpose |
|---|---|---|
| `/app` (layout) | `app/routes/app.jsx` | Embedded shell: App Bridge, Polaris, nav (Home/Products/Billing) |
| `/app/_index` | `app/routes/app._index.jsx` | Analytics: views/carts/purchases, CTR, top 5 products, 7-day SVG chart, limit warnings, conversion funnel |
| `/app/products` | `app/routes/app.products.jsx` | Product sync/add/delete UI, IndexTable, App Bridge resource picker, plan limit bar |
| `/app/billing` | `app/routes/app.billing.jsx` | 3-column plan cards (Free/Basic/Pro), upgrade/downgrade |
| `/app/billing/subscribe` | `app/routes/app.billing.subscribe.jsx` | Handles plan change → billing.request(), handles Free downgrade (cancel active subscription) |
| `/app/billing/success` | `app/routes/app.billing.success.jsx` | Post-payment confirmation page |

### Public API (Storefront — App Proxy HMAC, CORS-enabled)
| Route | File | Method | Purpose |
|---|---|---|---|
| `/api/track` | `app/routes/api.track.jsx` | POST | Receives visitor activity, saves to DB, fire-and-forget auto-syncs missing products |
| `/api/recommendations` | `app/routes/api.recommendations.jsx` | GET | Recommendation engine: collaborative filtering → JSON with products + scores |
| `/api/gdpr` | `app/routes/api.gdpr.jsx` | GET/DELETE | Manual data export/erasure by visitorId |

### Webhooks (Shopify → App)
| Route | File | Topic |
|---|---|---|
| `/webhooks/app/uninstalled` | `app/routes/webhooks.app.uninstalled.jsx` | `app/uninstalled` — deactivates shop, clears token, deletes session |
| `/webhooks/app/scopes_update` | `app/routes/webhooks.app.scopes_update.jsx` | `app/scopes_update` |
| `/webhooks/gdpr/<topic>` | `app/routes/webhooks.gdpr.$topic.jsx` | `customers/data_request`, `customers/redact`, `shop/redact` |
| *(inline)* | `app/shopify.server.js` | `APP_SUBSCRIPTIONS_UPDATE` — syncs subscription status to DB |

---

## Critical: GID Stripping for Variant IDs

**Problem:** Shopify Admin GraphQL API returns variant IDs as GID format (`gid://shopify/ProductVariant/45678901234`), but storefront `/cart/add.js` requires plain numeric IDs (`45678901234`). Sending GID causes 422 "Cannot find variant" error.

**Solution:** `app/utils/gid.js` — `extractNumericGid()` function strips GID prefix. Changed **every** place variant IDs are stored:

| File | Fix |
|---|---|
| `app/utils/gid.js` | **New file** — `extractNumericGid("gid://shopify/ProductVariant/123")` → `"123"` |
| `app/services/products.server.js` | Both `syncProducts()` and `syncProductsWithLimit()` now call `extractNumericGid()` before storing |
| `app/routes/api.track.jsx` | `syncProductInBackground()` also strips GID |
| `app/routes/app.products.jsx` | Resource Picker "Search & Add" now stores `firstVariantId` + `compareAtPrice` (was missing both), with GID stripping |
| `extensions/visitor-tracker/assets/tracker.js` | Client-side `stripGid()` safety net in ATC click handler for any legacy data |

---

## Recommendation Algorithm

**Location:** `app/routes/api.recommendations.jsx`

### Flow:
1. **Limit check** — monthly recommendation count vs plan limit (calendar month, resets on 1st)
2. **Rate limit** — 30 req/min per visitorId + IP
3. **Collaborative filtering** — find visitors who viewed current product → get their other events
4. **Event-weighted scoring:**
   - Purchase = 5×, Cart = 3×, View = 1×
   - Recency decay: `exp(-ln(2)/14 * daysAgo)` (14-day half-life)
5. **Score Map** — sum `eventWeight × recencyFactor` per product → top 4 (or up to remaining monthly limit)
6. **Activity fallback** — if < 4 recs, top store-wide products (same scoring), excluding current product and already-selected products
7. **Cold-start fallback** — if still empty (0 activity), newest products from cache → `coldStart: true`
8. **Handle backfill** — batch `nodes(ids: [...])` single GraphQL query for any null handles
9. **Log impressions** — writes to `Recommendation` table for analytics

### Response fields:
`recommendations[]` (id, title, handle, price, compareAtPrice, imageUrl, firstVariantId, score), `shopCurrency`, `coldStart`, `limitUsage`

---

## Storefront Widget (`extensions/visitor-tracker/assets/tracker.js`)

Vanilla JS, ~530 lines. Runs on storefront product pages via theme app extension block.

### Features:
- **Visitor ID:** Generated once, stored in localStorage (`v_` + random + timestamp)
- **Product page detection:** `window.ShopifyAnalytics.meta.product.id`
- **View tracking:** POST on page load + duration on `beforeunload`
- **Cart tracking:** Click listener on `[name="add"]`, `.add-to-cart`, `#AddToCart`, `.product-form__submit`
- **Purchase tracking:** `Shopify.Checkout.step === "thank_you"` → iterates line items
- **Recommendation fetch:** GET `/api/recommendations` → renders widget

### Widget rendering:
- **3 heading states:** "Recommended for You" / "Popular Products" (cold start) / "Coming Soon" (empty)
- **Card design:** 2-col mobile, 4-col desktop grid. Image, title, price row, ATC button
- **Sale badge:** Red badge top-left when `compareAtPrice > price`
- **ATC button:** POSTs `/cart/add.js` with numeric variant ID. Loading spinner → "✓ Added" → tracks cart event. On success: fetches `/cart.js` to update theme cart count badges, dispatches `cart:updated` + `cart:requestRender` custom events so theme drawer components sync
- **Dark mode:** Full `@media (prefers-color-scheme: dark)` support
- **Currency:** Uses `Intl.NumberFormat` with `shopCurrency` from API (no hardcoded `$`)
- **Smart insertion:** After `.product`, `.product-single`, `#MainContent`, or `<main>`

### GDPR Consent:
- Opt-out banner on first visit ("This site uses analytics…")
- Accept → enables tracking. Decline → purges server data via DELETE `/api/gdpr` + clears localStorage
- `getConsent()` gate at top of IIFE — if declined, entire tracker exits

---

## Services Layer

| File | Purpose |
|---|---|
| `app/services/billing.service.js` | Plan definitions (keys, limits, features), `buildShopifyBillingConfig()`, `getPlanByName()` |
| `app/services/recommendation-limit.service.js` | Resolves active plan, counts monthly recs (calendar month), returns `{ allowed, limit, used, remaining }` |
| `app/services/products.server.js` | Shopify GraphQL product sync: `syncProducts()` (50), `syncProductsWithLimit()` (plan-aware + GID stripping) |
| `app/services/tracker.server.js` | `saveActivity()` — creates VisitorActivity row |
| `app/services/shop.server.js` | `saveShopToDb()` — upserts shop record after OAuth |
| `app/services/tenant.service.js` | `resolveTenant()` — upserts Shop, returns `{ id }` for FK use |
| `app/services/rate-limiter.server.js` | In-memory sliding window. Per visitorId + IP. Auto-cleanup every 60s. Track: 60/min, Recs: 30/min |
| `app/utils/gid.js` | `extractNumericGid()` — strips Shopify GID prefix from variant IDs |
| `app/repositories/shops.repository.js` | **Unused** — references wrong schema fields. Not wired in. |

---

## Complete Fix History

### 2026-06-15 — Distribution Audit + Bug Fixes

| # | Issue | Fix |
|---|---|---|
| 14 | **Variant GID → /cart/add.js 422 error** | Created `app/utils/gid.js`, applied `extractNumericGid()` to all 4 product sync/write locations + client-side `stripGid()` in tracker.js |
| 15 | **ATC success — cart UI not updating** | Added `/cart.js` fetch + DOM badge updates + `cart:updated`/`cart:requestRender` custom events |
| 16 | **Spinner persists after "✓ Added"** | Added `btn.classList.remove("loading")` + `spinner.style.display = "none"` in success path |
| 17 | **Scopes overly broad** | Changed to `read_products` in `shopify.app.toml`, `.env`, `.env.example` |
| 18 | **Template metaobjects/metafields** in toml | Removed `demo_info` metafield + `example` metaobject definitions |
| 19 | **GDPR webhooks causing `npm run dev` crash** — Shopify CLI rejects GDPR topics (`customers/data_request` etc.) in toml | Removed from toml; GDPR handled separately (handler code intact in `webhooks.gdpr.$topic.jsx`) |
| 20 | **Landing page template text** | Replaced with actual branding + 3 real features |
| 21 | **`shopify.web.toml` name** "React Router" | Changed to `product-recommendation` |
| 22 | **`root.jsx` missing App Bridge CDN** — mandatory for Web Vitals + Built for Shopify | Added `<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />` in `<head>` |
| 23 | **`.env.example` outdated** | Cleaned: removed PG, session secret, Redis; fixed scopes; `NODE_ENV=production` |
| 24 | **`.env` bloat** | Removed unused DATABASE_URL, SESSION_SECRET, REDIS_URL |
| 25 | **Orphan file** `billing.service copy.js` | Deleted |
| 26 | **Dashboard loader — 13 sequential DB queries** | Refactored to 2-phase parallel: Phase 1 runs 8 independent queries in `Promise.all`, Phase 2 runs 2 dependent groups in parallel. 13 round-trips → 2 |
| 27 | **Missing ErrorBoundary** on 4 admin pages (`app._index`, `app.products`, `app.billing`, `app.billing/subscribe`) | Added `ErrorBoundary` + `headers` exports to all 4 pages (standard Shopify React Router pattern) |
| 28 | **Sequential loaders** on products, billing, billing/success pages | Parallelized all loaders/actions with `Promise.all` — DB queries + `billing.check()` now run concurrently |
| 29 | **Loader regression under dev** — GDPR topics in toml cause `npm run dev` failure | Removed GDPR topics from `shopify.app.toml` (Shopify CLI rejects them during dev preview); handler code intact in `webhooks.gdpr.$topic.jsx` |

### 2026-06-14 — Previous Session

| # | Issue | Fix |
|---|---|---|
| 6 | **Sequential handle fetches** — N GraphQL calls for N products with null handles | Batched `nodes(ids: [...])` single query, handleMap distribution |
| 7 | **Title-to-slug fallback** generated wrong URLs (404) | `rec.handle ? /products/${rec.handle} : "#"` safe fallback |
| 8 | **Cold start silent failure** — no products, no user message | 3-state rendering: Popular Products / Recommended for You / Coming Soon |
| 9 | **No rate limiting** — bot could exhaust monthly limit | In-memory sliding window: 30/min recs, 60/min track, per visitorId+IP |
| 10 | **Generic "Server error"** masked actual errors | `error.message \|\| "Server error"` in all catch blocks |
| 11 | **Prisma Generate EPERM** (Windows ARM64) | Rename locked `.dll.node` before re-running prisma generate |
| 12 | **Shopify GraphQL field error** — `minVariantPrice` in `compareAtPriceRange` | Fixed to `minVariantCompareAtPrice` |
| 13 | **Blocking auto-sync** delayed track endpoint response | Fire-and-forget `syncProductInBackground()` — no `await` |
| dev | **`npm run dev` crash** — missing locales dir + GDPR topics | Created `locales/en.default.json`, removed GDPR topics from toml (later re-added as webhook subscriptions on 6/15) |

### Earlier — Product Sync & Widget UI

- Database indexes added for `VisitorActivity` and `Recommendation`
- `firstVariantId` + `compareAtPrice` + `handle` added to Product model and sync logic
- Widget card redesign: ATC button, SALE badge (red, top-left), strikethrough compare-at price
- Resource Picker `add_products` now stores all Product fields including `compareAtPrice` + `firstVariantId`

---

## Data Flow (End-to-End)

```
1. Visitor lands on product page
   → tracker.js loads, generates visitorId, GDPR consent check → POST /api/track (view)
   → Background: auto-sync missing product to cache if not found

2. Tracker.js fetches GET /api/recommendations?productId=X&visitorId=Y
   → Rate limit check → Plan limit check
   → Collaborative filtering → Event-weighted scoring + recency decay
   → Fallback → Cold start → Batch handle fetch → Log impressions → Return JSON

3. Widget renders with cards, prices, sale badges, ATC buttons

4. Visitor clicks ATC button
   → stripGid() → POST /cart/add.js (numeric variant ID)
   → On success: POST /api/track (cart) + update theme cart UI

5. Visitor completes purchase (thank-you page)
   → tracker.js detects step=thank_you → POST /api/track (purchase) × each line item
```

---

## App Configuration (`shopify.app.toml`)

Key points:
- **Scopes:** `read_products` (minimal, just what's needed for product sync)
- **Webhooks subscribed:** `app/uninstalled`, `app/scopes_update`, `customers/data_request`, `customers/redact`, `shop/redact`
- **App proxy:** `/apps/recommendation-tracker` → storefront API endpoints (HMAC auth)
- **`include_config_on_deploy = true`** → Shopify Managed Installation enabled automatically
- **`application_url`** and **`app_proxy.url`** = `https://example.com` — **MUST update to real production URL before deploy**

---

## Before Production Deploy Checklist

- [ ] Set `SHOPIFY_BILLING_TEST=false` in `.env`
- [ ] Update `application_url` in `shopify.app.toml` to production URL
- [ ] Update `app_proxy.url` in `shopify.app.toml` to production URL
- [ ] Update `auth.redirect_urls` in `shopify.app.toml` to production URL
- [ ] Set `SHOPIFY_APP_URL` in `.env` to production URL
- [ ] Upload App Icon (1024×1024) in Partners Dashboard
- [ ] Upload Feature Graphic (1600×900) in Partners Dashboard
- [ ] Add Privacy Policy URL in Distribution page
- [ ] Add App Store listing: description, screenshots (3-5), keywords
- [ ] Replace `public/favicon.ico` with proper icon file
- [ ] Either set `NODE_ENV=production` in `.env` or deploy with it
- [ ] Consider migrating from SQLite to PostgreSQL if multi-instance deployment
- [ ] Consider Redis for rate limiting if multi-instance deployment

---

## Key Architectural Decisions

- **SQLite** — single-file DB, no separate DB server needed. Enforces tenant isolation via WHERE clauses
- **Vanilla JS widget** — no React on storefront. Minimal JS footprint, no framework dependency
- **App Proxy auth** — all public API endpoints authenticated via HMAC (Shopify signs requests), not API keys
- **In-memory rate limiter** — no Redis dependency. Adequate for single-server deployment. Needs Redis for multi-instance
- **Calendar-month billing** — recommendation count resets on 1st of each month (uses `new Date(year, month, 1)`)
- **Fire-and-forget sync** — product sync from Shopify happens in background, doesn't block API responses
- **Numeric variant IDs** — all `firstVariantId` stored as plain numeric string (GID stripped at storage time)
- **No extracted components** — all Polaris UI code inline in route files (components/ dirs exist but empty)
