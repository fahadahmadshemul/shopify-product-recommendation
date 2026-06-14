# Product Recommendation System — Architecture & Knowledge Base

> Auto-generated: 2026-06-14 — full system analysis for future development

## Tech Stack
- **Framework:** React Router v7 (file-based routing, SSR)
- **Database:** Prisma ORM + SQLite (`prisma/dev.sqlite`)
- **UI:** Shopify Polaris + App Bridge
- **Platform:** Shopify Embedded App (App Store distribution)
- **Storefront:** Theme App Extension (Liquid + JS tracker)

## Database Schema (6 models)

| Model | Purpose | Key Fields |
|---|---|---|
| Session | Shopify OAuth sessions | id, shop, accessToken, scope |
| Shop | Merchant store record | id, shop (unique), accessToken, isActive |
| Product | Synced product cache | id (gid://), title, handle, price, imageUrl, shopDomain |
| VisitorActivity | User behavior tracking | visitorId, shopDomain, productId, eventType (view/cart/purchase), duration |
| Recommendation | Generated rec log | visitorId, shopDomain, productId, score |
| BillingSubscription | Payment/subscription | id, shopId, shopifySubscriptionId, planKey, status |

## Billing Plans (3 tiers)

| Plan | Products | Recommendations/mo | Analytics | Price |
|---|---|---|---|---|
| FREE | 2 | 10 | No | $0 |
| BASIC | 7 | 15 | No | $7.99/mo |
| PRO | Unlimited (null) | Unlimited (null) | Yes | $13.99/mo |

Plan definitions: `app/services/billing.service.js`

## Key Service Files

| File | Purpose |
|---|---|
| `app/services/billing.service.js` | Plan definitions, helpers (`getPlan`, `getPlanByName`, `isFreePlan`, `buildShopifyBillingConfig`) |
| `app/services/recommendation-limit.service.js` | **NEW** — monthly recommendation limit enforcement (`checkRecommendationLimit`, `getActivePlanKey`, `getMonthlyRecommendationCount`) |
| `app/services/products.server.js` | Product sync from Shopify GraphQL, limit-aware (`syncProducts`, `syncProductsWithLimit`, `getProductsFromDB`) |
| `app/services/tracker.server.js` | Visitor activity persistence (`saveActivity`) |
| `app/services/shop.server.js` | Shop registration on auth (`saveShopToDb`) |
| `app/services/tenant.service.js` | Tenant resolution before billing (`resolveTenant`) |
| `app/repositories/shops.repository.js` | Shop data access layer (NOTE: uses `shopDomain` field, may be out of sync with schema's `shop` field) |

## Route Files

| Route | File | Purpose |
|---|---|---|
| `/auth/login` | `auth.login/route.jsx` | Login form |
| `/auth/*` | `auth.$.jsx` | OAuth catch-all |
| `/app` | `app.jsx` | Layout (App Bridge + Polaris provider + nav bar) |
| `/app/_index` | `app._index.jsx` | Dashboard — analytics, metrics, chart, **rec limit banner/card** |
| `/app/products` | `app.products.jsx` | Product manager — sync/add/delete with plan-limit enforcement |
| `/app/billing` | `app.billing.jsx` | 3-column plan cards, upgrade/downgrade UI |
| `/app/billing/subscribe` | `app.billing.subscribe.jsx` | POST action → Shopify billing charge |
| `/app/billing/success` | `app.billing.success.jsx` | Post-payment confirmation |
| `/api/track` | `api.track.jsx` | Storefront tracking endpoint (POST), auto-syncs missing products |
| `/api/recommendations` | `api.recommendations.jsx` | Recommendation engine + **limit enforcement** (GET) |
| `/webhooks/app/uninstalled` | `webhooks.app.uninstalled.jsx` | Deactivates shop on uninstall |
| `/webhooks/app/scopes_update` | `webhooks.app.scopes_update.jsx` | Updates session scope |

## Recommendation Algorithm (in `api.recommendations.jsx`)
1. Find other visitors who viewed the current product (exclude current visitor)
2. Get co-occurring products those visitors viewed → groupBy count, take top 4
3. Fallback to top-viewed store-wide products if < 4 results
4. Fetch product details from cached Product table
5. On-the-fly fix missing handles via Shopify GraphQL
6. Log all impressions to Recommendation table
7. Return JSON to storefront tracker widget

## Storefront Extension (`extensions/visitor-tracker/`)
- `assets/tracker.js` — full client-side JS: generates visitor ID, tracks view/cart/purchase events, fetches recommendations from `/api/recommendations`, renders "Recommended for You" widget as CSS grid
- `blocks/visitor_tracker.liquid` — Liquid block injected into theme

## Limit Enforcement (Implemented 2026-06-14)

### API-level (`/api/recommendations`)
- `checkRecommendationLimit()` runs before any recommendation computation
- If monthly limit exceeded → returns `{ recommendations: [], limitReached: true, message: "..." }`
- Limit is per-calendar-month, counted from Recommendation table `createdAt`

### Dashboard (`/app`)
- Critical red banner when limit fully exhausted
- Yellow warning banner when ≤3 remaining
- Sidebar card showing: plan name, used/limit progress bar, remaining count, upgrade link
- Progress bar: green → amber at 80% → red at 100%

### Plan resolution
- Checks `BillingSubscription` table for ACTIVE subscription
- Falls back to `Shop` relation → `subscriptions` include
- Defaults to FREE plan if no active subscription found

## Key Architectural Notes
1. Product ID format: `gid://shopify/Product/{numeric_id}`
2. Shopify billing webhook `APP_SUBSCRIPTIONS_UPDATE` syncs subscription status to local DB
3. `billing.service copy.js` has different (higher) limits — appears to be a draft
4. Components directory is empty — all UI inline in route files
5. `shops.repository.js` may be out of sync with schema (uses `shopDomain` vs `shop`)
6. `.env.example` references PostgreSQL but currently on SQLite
