import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkRecommendationLimit } from "../services/recommendation-limit.service";
import { checkRateLimit } from "../services/rate-limiter.server";
import { getWidgetSettings } from "../services/widget-settings.service";

// CORS headers for preflight request routing
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Authenticate the request via Shopify App Proxy signatures
    const { session, admin } = await authenticate.public.appProxy(request);
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
    const shopRecord = await db.shop.findUnique({
      where: { shop: shopDomain },
      select: { currency: true },
    });
    const shopCurrency = shopRecord?.currency || "USD";

    // Check monthly recommendation limit based on billing plan
    const limitCheck = await checkRecommendationLimit(shopDomain);
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

    // --- Recommendation Algorithm with Event-Weighted Scoring & Recency Decay ---
    // Event weights: purchase = 5, cart = 3, view = 1
    // Recency half-life: 14 days

    const EVENT_WEIGHTS = { purchase: 5, cart: 3, view: 1 };
    const RECENCY_HALF_LIFE_DAYS = 14;
    const RECENCY_DECAY_RATE = Math.LN2 / RECENCY_HALF_LIFE_DAYS;

    const isProPlan = limitCheck.planKey === "PRO";
    const priorityBoost = isProPlan ? 1.5 : 1;

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
      const relatedEvents = await db.visitorActivity.findMany({
        where: {
          shopDomain,
          visitorId: { in: visitorIds },
          productId: { not: productId },
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
      const scoreMap = new Map();

      for (const event of relatedEvents) {
        const daysAgo = (now - new Date(event.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const recencyFactor = Math.exp(-RECENCY_DECAY_RATE * daysAgo);
        const eventWeight = EVENT_WEIGHTS[event.eventType] || 1;
        const score = eventWeight * recencyFactor * priorityBoost;

        scoreMap.set(event.productId, (scoreMap.get(event.productId) || 0) + score);
      }

      // Sort by weighted score descending, take top maxRecs
      recommendedProductIds = [...scoreMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxRecs)
        .map(([id, score]) => ({ id, score: Math.round(score * 100) / 100 }));
    }

    // 3. Fallback to top engaging products if fewer than maxRecs recommendations
    if (recommendedProductIds.length < maxRecs) {
      const excludedIds = [productId, ...recommendedProductIds.map((r) => r.id)];

      const topEvents = await db.visitorActivity.findMany({
        where: {
          shopDomain,
          productId: { notIn: excludedIds },
        },
        select: {
          productId: true,
          eventType: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });

      const fallbackMap = new Map();
      const now2 = Date.now();

      for (const event of topEvents) {
        const daysAgo = (now2 - new Date(event.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const recencyFactor = Math.exp(-RECENCY_DECAY_RATE * daysAgo);
        const eventWeight = EVENT_WEIGHTS[event.eventType] || 1;
        const score = eventWeight * recencyFactor * priorityBoost;
        fallbackMap.set(event.productId, (fallbackMap.get(event.productId) || 0) + score);
      }

      const missing = maxRecs - recommendedProductIds.length;
      const fallbackRecs = [...fallbackMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, missing)
        .map(([id, score]) => ({ id, score: Math.round(score * 100) / 100 || 1 }));

      recommendedProductIds = [...recommendedProductIds, ...fallbackRecs];
    }

    // 3b. Cold-start: no activity anywhere in the store — fall back to recent products
    if (recommendedProductIds.length === 0) {
      coldStart = true;
      const recentProducts = await db.product.findMany({
        where: { shopDomain },
        orderBy: { createdAt: "desc" },
        take: maxRecs,
        select: { id: true },
      });
      recommendedProductIds = recentProducts.map((p) => ({ id: p.id, score: 0 }));
    }

    // 4. Fetch details for recommended products from cache table
    const productIdsToFetch = recommendedProductIds.map((r) => r.id);
    const dbProducts = await db.product.findMany({
      where: {
        id: { in: productIdsToFetch },
        shopDomain,
      },
    });

    // Batch-fetch missing handles from Shopify in one query
    const productsMissingHandles = dbProducts
      .map((p, i) => ({ product: p, index: i }))
      .filter(({ product }) => !product.handle);

    if (productsMissingHandles.length > 0 && admin) {
      try {
        const ids = productsMissingHandles.map(({ product }) => product.id);
        const gqlResponse = await admin.graphql(`
          query {
            nodes(ids: [${ids.map((id) => `"${id}"`).join(", ")}]) {
              ... on Product {
                id
                handle
              }
            }
          }
        `);
        const gqlData = await gqlResponse.json();
        const nodes = gqlData.data?.nodes || [];
        const handleMap = new Map(nodes.filter(Boolean).map((n) => [n.id, n.handle]));

        for (const { product, index } of productsMissingHandles) {
          const handle = handleMap.get(product.id);
          if (handle) {
            const updated = await db.product.update({
              where: { id: product.id },
              data: { handle },
            });
            dbProducts[index] = updated;
            console.log(`On-the-fly updated missing handle for ${product.id}: ${handle}`);
          }
        }
      } catch (err) {
        console.error(`Failed to batch-fetch missing handles:`, err);
      }
    }

    // Match details and scores, maintaining the recommended order
    const productMap = new Map(dbProducts.map((p) => [p.id, p]));
    const finalRecommendations = recommendedProductIds
      .map((rec) => {
        const prod = productMap.get(rec.id);
        if (!prod) return null;
        return {
          ...prod,
          score: rec.score,
        };
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
        widgetSettings: await getWidgetSettings(shopDomain),
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Recommendations API error:", error);
    return Response.json(
      { error: error.message || "Server error" },
      { status: 500, headers: corsHeaders }
    );
  }
};
