# Session Context — Product Recommendation System

## Project Overview
Shopify embedded app for product recommendations. Uses Shopify App Proxy to inject recommendation widgets on storefront product pages. Tracks visitor activity (view/cart/purchase) and serves personalized recommendations via collaborative filtering.

---

## System Architecture

### Database (SQLite via Prisma)
- **Product** — synced product cache (id, title, handle, price, compareAtPrice, imageUrl, firstVariantId, shopDomain)
- **VisitorActivity** — raw events from storefront (visitorId, shopDomain, productId, eventType, duration, createdAt)
- **Recommendation** — logged impressions (visitorId, shopDomain, productId, score, createdAt)
- **BillingSubscription** — plan subscriptions (shopId, planKey, status)
- **Shop** — tenant isolation

### Billing Plans
| Plan | Price | Products | Recommendations/Month |
|------|-------|----------|----------------------|
| Free | $0 | 2 | 10 |
| Basic | $7.99 | 7 | 15 |
| Pro | $13.99 | Unlimited | Unlimited |

### Key Files
- `app/routes/api.recommendations.jsx` — Recommendation algorithm + endpoint
- `app/routes/api.track.jsx` — Event tracking endpoint + auto-sync
- `extensions/visitor-tracker/assets/tracker.js` — Client-side JS (renders widget, tracks events, ATC buttons)
- `extensions/visitor-tracker/blocks/visitor_tracker.liquid` — Injects tracker.js into storefront
- `app/services/recommendation-limit.service.js` — Monthly limit enforcement
- `app/services/billing.service.js` — Plan definitions
- `app/services/products.server.js` — Shopify GraphQL product sync
- `app/services/tracker.server.js` — Save visitor activity to DB
- `app/routes/app._index.jsx` — Admin dashboard (analytics + limit warnings)
- `prisma/schema.prisma` — Database schema

### Recommendation Algorithm (v2 — session 2026-06-14)
- Collaborative filtering: finds visitors who viewed current product, checks what else they engaged with
- **Event-weighted scoring:** purchase=5, cart=3, view=1
- **Recency decay:** 14-day half-life via exponential decay
- **Fallback:** top engaging products store-wide (same weighted+recency scoring)
- Max 4 recommendations (capped to remaining monthly limit)
- Product details fetched from cache, missing handles fetched on-the-fly from Shopify GraphQL

### Data Flow
1. Visitor lands on product page → tracker.js loads → generates visitorId
2. POST `/api/track` → saves view event → auto-syncs product if missing (with handle, compareAtPrice, firstVariantId)
3. GET `/api/recommendations?productId=...&visitorId=...` → limit check → algorithm → returns JSON
4. tracker.js renders widget with cards, sale badges, ATC buttons
5. ATC button click → POST `/cart/add.js` → track cart event
6. Purchase on thank-you page → track purchase events

---

## Changes Made (2026-06-14)

### 1. Algorithm Upgrade
**File:** `app/routes/api.recommendations.jsx`
- Replaced raw co-occurrence counting with event-weighted scoring + recency decay
- Event weights: purchase=5, cart=3, view=1
- Recency: exponential decay with 14-day half-life
- Capped recommendations to `Math.min(4, remainingMonthlyLimit)` (fixes overshoot bug)

### 2. Card Redesign + Add-to-Cart
**File:** `extensions/visitor-tracker/assets/tracker.js`
- Added green Add-to-Cart button (POSTs to `/cart/add.js` with variant ID)
- Added "SALE" badge (red, top-left of image) when compareAtPrice > price
- Added strikethrough compare-at price next to regular price
- Loading spinner → "✓ Added" state on ATC button
- Click tracking excludes ATC button clicks
- Dark mode fully supported for all new elements
- Cards now have background (#fafafa), border, hover shadow

### 3. Schema: Added firstVariantId
**File:** `prisma/schema.prisma` — Added `firstVariantId String?` to Product model
**Migration:** `20260614063148_add_first_variant_id_to_product`

### 4. Product Sync: Added compareAtPrice + firstVariantId
**File:** `app/services/products.server.js` — Both `syncProducts()` and `syncProductsWithLimit()` now fetch `compareAtPriceRange` and `variants(first:1)` from Shopify GraphQL

### 5. Auto-sync: Added handle + compareAtPrice + firstVariantId
**File:** `app/routes/api.track.jsx` — Auto-sync when product missing now saves handle, compareAtPrice, and firstVariantId (previously only saved title, price, imageUrl)

---

---

## Changes Made (2026-06-14 — Bug Fixes)

### 6. Prisma Generate EPERM Fix (Windows)
**Issue:** `npx prisma generate` failed with `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`
**Root cause:** `query_engine-windows.dll.node` locked by a process (possibly Windows Defender or leftover Node process)
**Fix:** Rename the locked `.dll.node` file first using `ren` (not `del`), then re-run `prisma generate`. Deleting doesn't work because Windows locks prevent deletion, but rename succeeds and frees the filename for Prisma to write the new file.
**Files:** `node_modules\.prisma\client\query_engine-windows.dll.node`
**Tip:** Always try `ren oldfile.dll.node oldfile.dll.old` first before attempting delete on Windows.

### 7. Fixed Shopify GraphQL Field Name Error
**Issue:** `Field 'minVariantPrice' doesn't exist on type 'ProductCompareAtPriceRange'`
**Root cause:** `ProductCompareAtPriceRange` type uses `minVariantCompareAtPrice`, not `minVariantPrice` (unlike `ProductPriceRangeV2` which does use `minVariantPrice`)
**Fix:** Changed all GraphQL queries from `compareAtPriceRange { minVariantPrice }` → `compareAtPriceRange { minVariantCompareAtPrice }` and updated JS accessors accordingly.
**Files affected:**
- `app/routes/api.track.jsx` — Auto-sync query + accessor
- `app/services/products.server.js` — Both `syncProducts()` and `syncProductsWithLimit()` queries + accessors

---

## TODO / Future Improvements
- Add recommendations to cart page cross-sell section
- Add "Recently Viewed" widget
- Machine learning: weight tuning per shop based on conversion data
- A/B test: widget placement vs conversion rate
