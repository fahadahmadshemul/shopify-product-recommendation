import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkRecommendationLimit } from "../services/recommendation-limit.service";
import { checkRateLimit } from "../services/rate-limiter.server";
import { getWidgetSettings } from "../services/widget-settings.service";
import { extractNumericGid } from "../utils/gid.js";

// CORS headers for preflight request routing
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Shared availability check used by recommendation filters AND the Quick Add eligibility flag.
 * A product is treated as available when:
 *   - totalInventory is null (not yet synced) OR > 0
 *   - status is null (not yet synced) OR "ACTIVE"
 */
function isProductAvailable(product) {
  const hasInventory = product.totalInventory === null || product.totalInventory > 0;
  const isActiveStatus = product.status === null || product.status === "ACTIVE";
  return hasInventory && isActiveStatus;
}

function safeJsonError(error, status = 500) {
  console.error(`Recommendations API error (${status}):`, error);
  return Response.json(
    { error: error?.message || "Server error" },
    { status, headers: corsHeaders }
  );
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Authenticate the request via Shopify App Proxy signatures
    let session;
    let admin = null;
    try {
      const authResult = await authenticate.public.appProxy(request);
      session = authResult.session;
      admin = authResult.admin || null;
    } catch (authErr) {
      console.error("Recommendations API authentication failed:", authErr);
      return safeJsonError(new Error("Authentication failed"), 401);
    }

    const shopDomain = session ? session.shop : new URL(request.url).searchParams.get("shop");
    if (!shopDomain) {
      return Response.json(
        { error: "Missing shop domain" },
        { status: 400, headers: corsHeaders }
      );
    }

    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");
    const visitorId = url.searchParams.get("visitorId");

    // Fetch shop currency for client-side formatting
    let shopCurrency = "USD";
    try {
      const shopRecord = await db.shop.findUnique({
        where: { shop: shopDomain },
        select: { currency: true },
      });
      shopCurrency = shopRecord?.currency || "USD";
    } catch (shopErr) {
      console.error("Recommendations API: failed to fetch shop currency:", shopErr);
    }

    // Check monthly recommendation limit based on billing plan
    let limitCheck;
    try {
      limitCheck = await checkRecommendationLimit(shopDomain);
    } catch (limitErr) {
      console.error("Recommendations API: failed to check recommendation limit:", limitErr);
      limitCheck = { allowed: true, limit: null, used: 0, remaining: Infinity, planName: "Free", planKey: "FREE" };
    }
    if (!limitCheck.allowed) {
      return Response.json(
        {
          recommendations: [],
          limitReached: true,
          message: `Monthly recommendation limit (${limitCheck.limit}) reached on your ${limitCheck.planName} plan. Upgrade to unlock unlimited recommendations.`,
        },
        { headers: corsHeaders }
      );
    }

    let coldStart = false;

    // Cap max recommendations to remaining monthly allowance
    const maxRecs = Math.min(4, limitCheck.remaining === Infinity ? 4 : limitCheck.remaining);

    if (!productId || !visitorId) {
      return Response.json(
        { error: "Missing productId or visitorId" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Rate limit per visitor + IP (30 req/min)
    const rateCheck = checkRateLimit(request, visitorId, { maxRequests: 30, windowMs: 60_000 });
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({ error: "Too many requests", retryAfter: rateCheck.retryAfter }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rateCheck.retryAfter) } }
      );
    }

    // Build the set of products to exclude from all recommendation paths.
    // A product is excluded if:
    //   (a) the merchant manually flagged it (excludedFromRecs = true), OR
    //   (b) it has a known non-ACTIVE status (null status = not yet synced → treated as ACTIVE), OR
    //   (c) it has an explicit zero-inventory count (null = unknown → treated as available)
    // This set is applied at scoring time (not just fetch time) so excluded products
    // don't indirectly boost co-occurring products' scores.
    const unavailableProducts = await db.product.findMany({
      where: {
        shopDomain,
        OR: [
          { excludedFromRecs: true },
          { status: { not: null, notIn: ["ACTIVE"] } },
          { totalInventory: 0 },
        ],
      },
      select: { id: true },
    });
    const excludedProductIds = new Set([
      productId, // always exclude the current product from its own recommendations
      ...unavailableProducts.map((p) => p.id),
    ]);

    // 1. Find other visitors who interacted with the current product
    const otherVisitors = await db.visitorActivity.findMany({
      where: {
        shopDomain,
        productId,
        visitorId: { not: visitorId },
      },
      select: { visitorId: true },
      distinct: ["visitorId"],
      take: 200,
    });

    const visitorIds = otherVisitors.map((v) => v.visitorId);
    let recommendedProductIds = [];

    if (visitorIds.length > 0) {
      // 2. Fetch raw events from those visitors (for weighted & recency scoring)
      //    Exclude unavailable/merchant-excluded products at query time so they don't
      //    accumulate score and don't inflate scores of co-occurring products.
      const relatedEvents = await db.visitorActivity.findMany({
        where: {
          shopDomain,
          visitorId: { in: visitorIds },
          productId: { notIn: [...excludedProductIds] },
        },
        select: {
          productId: true,
          eventType: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 2000,
      });

      // Apply recency decay + event weight to score each product
      const now = Date.now();
      const scoreMap = scoreEvents(relatedEvents, now, limitCheck.planKey);

      // Sort by weighted score descending, take top maxRecs
      recommendedProductIds = [...scoreMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxRecs)
        .map(([id, score]) => ({ id, score: Math.round(score * 100) / 100 }));
    }

    // 3. Fallback to top engaging products if fewer than maxRecs recommendations
    if (recommendedProductIds.length < maxRecs) {
      // Merge already-recommended IDs into the excluded set so the fallback doesn't duplicate
      const fallbackExcluded = new Set([
        ...excludedProductIds,
        ...recommendedProductIds.map((r) => r.id),
      ]);

      const topEvents = await db.visitorActivity.findMany({
        where: {
          shopDomain,
          productId: { notIn: [...fallbackExcluded] },
        },
        select: {
          productId: true,
          eventType: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });

      const now2 = Date.now();
      const fallbackMap = scoreEvents(topEvents, now2, limitCheck.planKey);

      const missing = maxRecs - recommendedProductIds.length;
      const fallbackRecs = [...fallbackMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, missing)
        .map(([id, score]) => ({ id, score: Math.round(score * 100) / 100 || 1 }));

      recommendedProductIds = [...recommendedProductIds, ...fallbackRecs];
    }

    // 3b. Cold-start: no activity anywhere in the store — fall back to recent synced products.
    //     Apply the same availability/exclude filter so stale draft products don't surface.
    if (recommendedProductIds.length === 0) {
      coldStart = true;
      const recentProducts = await db.product.findMany({
        where: {
          shopDomain,
          excludedFromRecs: false,
          id: { notIn: [productId] },
          // Exclude products that are explicitly unavailable.
          // null status/inventory = not yet synced → backward-compat: treat as available.
          AND: [
            { NOT: { AND: [{ status: { not: null } }, { status: { notIn: ["ACTIVE"] } }] } },
            { NOT: { totalInventory: 0 } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: maxRecs,
        select: { id: true },
      });
      recommendedProductIds = recentProducts.map((p) => ({ id: p.id, score: 0 }));
    }

    // 4. Fetch details for recommended products from cache table.
    //    The excludedFromRecs filter here is a safety net — products should already be
    //    excluded upstream, but this prevents edge cases from slipping into the response.
    const productIdsToFetch = recommendedProductIds.map((r) => r.id);
    const dbProducts = await db.product.findMany({
      where: {
        id: { in: productIdsToFetch },
        shopDomain,
        excludedFromRecs: false,
      },
    });

    // Batch-fetch product details (handles + variants) from Shopify in one query.
    // We fetch for all recommended products because the cache table does not store variants.
    if (admin) {
      try {
        const ids = dbProducts.map((p) => p.id);
        const gqlResponse = await admin.graphql(
          `#graphql
          query GetProductDetails($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                handle
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      availableForSale
                      price {
                        amount
                      }
                    }
                  }
                }
              }
            }
          }`,
          { variables: { ids } }
        );
        const gqlData = await gqlResponse.json();
        const nodes = gqlData.data?.nodes || [];

        const handleMap = new Map();
        const variantsMap = new Map();

        for (const node of nodes.filter(Boolean)) {
          handleMap.set(node.id, node.handle);

          const variants = (node.variants?.edges || []).map((edge) => ({
            numericId: Number(extractNumericGid(edge.node.id)),
            title: edge.node.title,
            price: parseFloat(edge.node.price.amount),
            available: edge.node.availableForSale === true,
          }));
          variantsMap.set(node.id, variants);
        }

        // Backfill missing handles into DB cache for future requests.
        for (let i = 0; i < dbProducts.length; i++) {
          const product = dbProducts[i];
          const handle = handleMap.get(product.id);
          if (handle && !product.handle) {
            const updated = await db.product.update({
              where: { id: product.id },
              data: { handle },
            });
            dbProducts[i] = updated;
            console.log(`On-the-fly updated missing handle for ${product.id}: ${handle}`);
          }
        }

        // Attach variants to each product for the response.
        for (const product of dbProducts) {
          product.variants = variantsMap.get(product.id) || [];
        }
      } catch (err) {
        console.error(`Failed to batch-fetch product details:`, err);
        // Graceful fallback: return empty variants array so the response still works.
        for (const product of dbProducts) {
          product.variants = [];
        }
      }
    } else {
      for (const product of dbProducts) {
        product.variants = [];
      }
    }

    // Match details and scores, maintaining the recommended order
    const productMap = new Map(dbProducts.map((p) => [p.id, p]));
    const finalRecommendations = recommendedProductIds
      .map((rec) => {
        const prod = productMap.get(rec.id);
        if (!prod) return null;

        const variants = prod.variants || [];
        // Trust the DB flag first; if it disagrees with the live variant count,
        // the live count wins because that reflects the current catalog state.
        const hasSingleVariant = variants.length > 0
          ? variants.length <= 1
          : prod.hasSingleVariant !== false;
        const canQuickAdd = isProductAvailable(prod) && hasSingleVariant;

        // Always expose a usable variant ID if we possibly can. The client needs
        // *something* to send to /cart/add.js even if the live variant fetch failed.
        const fallbackVariantId = prod.firstVariantId || (variants[0] ? String(variants[0].numericId) : null);

        const result = {
          ...prod,
          score: rec.score,
          canQuickAdd,
          hasSingleVariant,
          variants,
          variantId: fallbackVariantId,
        };

        return result;
      })
      .filter(Boolean);

    // 5. Log recommendation impressions in database for conversion analytics
    if (finalRecommendations.length > 0) {
      try {
        await db.recommendation.createMany({
          data: finalRecommendations.map((rec) => ({
            visitorId,
            shopDomain,
            productId: rec.id,
            score: parseFloat(rec.score) || 1.0,
          })),
        });
      } catch (err) {
        console.error("Error creating recommendation logs:", err);
      }
    }

    // Fetch widget settings for the response, with a safe fallback.
    let widgetSettings = {};
    try {
      widgetSettings = await getWidgetSettings(shopDomain);
    } catch (settingsErr) {
      console.error("Recommendations API: failed to fetch widget settings:", settingsErr);
    }

    return Response.json(
      {
        recommendations: finalRecommendations,
        shopCurrency,
        coldStart,
        limitUsage: {
          used: limitCheck.used + finalRecommendations.length,
          limit: limitCheck.limit,
          planName: limitCheck.planName,
        },
        widgetSettings,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    return safeJsonError(error, 500);
  }
};

/**
 * Event-Weighted Scoring with Recency Decay.
 *
 * Event weights: purchase = 5, cart = 3, view = 1
 * Recency decay is calculated using an exponential decay model with a 14-day half-life:
 *   recencyFactor = exp(-decayRate * daysAgo)
 * PRO plan gets a 1.5x multiplier boost on all recommendation scores.
 *
 * @param {Array} events - Activity events to score (with eventType, createdAt, productId).
 * @param {number} now - The timestamp representing current time.
 * @param {string} planKey - Billing plan tier of the shop (e.g. "PRO", "BASIC", "FREE").
 * @returns {Map<string, number>} Map of productId -> raw score.
 */
export function scoreEvents(events, now, planKey) {
  const EVENT_WEIGHTS = { purchase: 5, cart: 3, view: 1 };
  const RECENCY_HALF_LIFE_DAYS = 14;
  const RECENCY_DECAY_RATE = Math.LN2 / RECENCY_HALF_LIFE_DAYS;

  const isProPlan = planKey === "PRO";
  const priorityBoost = isProPlan ? 1.5 : 1;
  const scoreMap = new Map();

  for (const event of events) {
    const daysAgo = (now - new Date(event.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyFactor = Math.exp(-RECENCY_DECAY_RATE * daysAgo);
    const eventWeight = EVENT_WEIGHTS[event.eventType] || 1;
    const score = eventWeight * recencyFactor * priorityBoost;

    scoreMap.set(event.productId, (scoreMap.get(event.productId) || 0) + score);
  }

  return scoreMap;
}
