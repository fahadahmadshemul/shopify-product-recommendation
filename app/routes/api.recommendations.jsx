import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkRecommendationLimit } from "../services/recommendation-limit.service";

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

    if (!productId || !visitorId) {
      return Response.json(
        { error: "Missing productId or visitorId" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 1. Find other visitors who viewed the current product
    const otherVisitors = await db.visitorActivity.findMany({
      where: {
        shopDomain,
        productId,
        eventType: "view",
        visitorId: { not: visitorId },
      },
      select: {
        visitorId: true,
      },
      distinct: ["visitorId"],
    });

    const visitorIds = otherVisitors.map((v) => v.visitorId);
    let recommendedProductIds = [];

    if (visitorIds.length > 0) {
      // 2. Query other products viewed by those visitors, ordered by frequency (co-occurrence)
      const coOccurrences = await db.visitorActivity.groupBy({
        by: ["productId"],
        where: {
          shopDomain,
          visitorId: { in: visitorIds },
          productId: { not: productId },
          eventType: "view",
        },
        _count: {
          productId: true,
        },
        orderBy: {
          _count: {
            productId: "desc",
          },
        },
        take: 4,
      });

      recommendedProductIds = coOccurrences.map((c) => ({
        id: c.productId,
        score: c._count.productId,
      }));
    }

    // 3. Fallback to top-viewed products in the store if we have less than 4 recommendations
    if (recommendedProductIds.length < 4) {
      const excludedIds = [productId, ...recommendedProductIds.map((r) => r.id)];
      const topOverall = await db.visitorActivity.groupBy({
        by: ["productId"],
        where: {
          shopDomain,
          productId: { notIn: excludedIds },
          eventType: "view",
        },
        _count: {
          productId: true,
        },
        orderBy: {
          _count: {
            productId: "desc",
          },
        },
        take: 4 - recommendedProductIds.length,
      });

      const fallbackRecs = topOverall.map((t) => ({
        id: t.productId,
        score: t._count.productId || 1,
      }));

      recommendedProductIds = [...recommendedProductIds, ...fallbackRecs];
    }

    // 4. Fetch details for recommended products from cache table
    const productIdsToFetch = recommendedProductIds.map((r) => r.id);
    const dbProducts = await db.product.findMany({
      where: {
        id: { in: productIdsToFetch },
        shopDomain,
      },
    });

    // Check if any product has a null handle and fetch it on-the-fly from Shopify
    for (let i = 0; i < dbProducts.length; i++) {
      const product = dbProducts[i];
      if (!product.handle && admin) {
        try {
          const gqlResponse = await admin.graphql(`
            query {
              product(id: "${product.id}") {
                handle
              }
            }
          `);
          const gqlData = await gqlResponse.json();
          const handle = gqlData.data?.product?.handle;
          if (handle) {
            // Update database cache
            const updated = await db.product.update({
              where: { id: product.id },
              data: { handle },
            });
            dbProducts[i] = updated;
            console.log(`On-the-fly updated missing handle for ${product.id}: ${handle}`);
          }
        } catch (err) {
          console.error(`Failed to fetch missing handle for ${product.id}:`, err);
        }
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
        limitUsage: {
          used: limitCheck.used + finalRecommendations.length,
          limit: limitCheck.limit,
          planName: limitCheck.planName,
        },
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Recommendations API error:", error);
    return Response.json(
      { error: "Server error" },
      { status: 500, headers: corsHeaders }
    );
  }
};
