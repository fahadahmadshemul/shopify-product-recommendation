import { authenticate } from "../shopify.server";
import { saveActivity } from "../services/tracker.server.js";
import { checkRateLimit } from "../services/rate-limiter.server";
import { getActivePlan } from "../services/recommendation-limit.service";
import { extractNumericGid } from "../utils/gid.js";
import db from "../db.server";

// CORS headers for preflight requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function syncProductInBackground(admin, productId, shopDomain, productLimit) {
  try {
    const currentCount = await db.product.count({
      where: { shopDomain },
    });

    if (productLimit !== null && currentCount >= productLimit) {
      console.log(`Background sync skipped: product limit (${productLimit}) reached for ${shopDomain}`);
      return;
    }

    const gqlResponse = await admin.graphql(`
      query {
        product(id: "${productId}") {
          title
          handle
          priceRangeV2 {
            minVariantPrice {
              amount
            }
          }
          compareAtPriceRange {
            minVariantCompareAtPrice {
              amount
            }
          }
          featuredImage {
            url
          }
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `);

    const gqlData = await gqlResponse.json();
    const productData = gqlData.data?.product;

    if (productData) {
      const price = parseFloat(productData.priceRangeV2.minVariantPrice.amount);
      const compareAtPrice = productData.compareAtPriceRange
        ? parseFloat(productData.compareAtPriceRange.minVariantCompareAtPrice.amount) || null
        : null;
      const imageUrl = productData.featuredImage ? productData.featuredImage.url : null;
      const variants = productData.variants?.edges || [];
      const firstVariantId = extractNumericGid(variants.length > 0 ? variants[0].node.id : null);

      await db.product.create({
        data: {
          id: productId,
          title: productData.title,
          handle: productData.handle,
          price,
          compareAtPrice,
          imageUrl,
          firstVariantId,
          shopDomain,
        },
      });
      console.log(`Auto-synced missing product: ${productId}`);
    }
  } catch (err) {
    console.error("Error auto-syncing missing product:", err);
  }
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return Response.json({ ok: true }, { headers: corsHeaders });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate through Shopify App Proxy to verify HMAC signature
    const { session, admin } = await authenticate.public.appProxy(request);

    // Get the shop domain from the session or fallback to request params
    const shopDomain = session ? session.shop : new URL(request.url).searchParams.get("shop");
    if (!shopDomain) {
      return Response.json(
        { error: "Missing shop domain" },
        { status: 400, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { visitorId, productId, eventType, duration } = body;

    if (!visitorId || !productId || !eventType) {
      return Response.json(
        { error: "Missing fields" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Rate limit per visitor + IP (60 req/min — tracks are lighter than recommendations)
    const rateCheck = checkRateLimit(request, visitorId, { maxRequests: 60, windowMs: 60_000 });
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({ error: "Too many requests", retryAfter: rateCheck.retryAfter }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rateCheck.retryAfter) } }
      );
    }

    // Fire-and-forget: sync missing product without blocking the response, respecting plan limit
    const exists = await db.product.findUnique({
      where: { id: productId },
    });

    if (!exists && admin) {
      const plan = await getActivePlan(shopDomain);
      syncProductInBackground(admin, productId, shopDomain, plan.limits.products);
    }

    // Save visitor activity (view, cart, purchase)
    await saveActivity({
      visitorId,
      shopDomain,
      productId,
      eventType,
      duration,
    });

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Track error:", error);
    return Response.json(
      { error: error.message || "Server error" },
      { status: 500, headers: corsHeaders }
    );
  }
};
