import { authenticate } from "../shopify.server";
import { saveActivity } from "../services/tracker.server.js";
import { checkRateLimit } from "../services/rate-limiter.server";
import { getActivePlan } from "../services/recommendation-limit.service";
import { extractNumericGid } from "../utils/gid.js";
import { signVisitorId } from "../utils/visitor-token.server.js";
import db from "../db.server";

// CORS headers for preflight requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Validates that productId is a Shopify Product GID before any GraphQL is issued.
// Prevents GraphQL injection: productId comes from an unauthenticated public POST body,
// so a malicious client could otherwise inject arbitrary query fragments via interpolation.
const PRODUCT_GID_REGEX = /^gid:\/\/shopify\/Product\/\d+$/;

async function syncProductInBackground(admin, productId, shopDomain, productLimit) {
  try {
    // 1. Validate format before hitting the DB or making a GraphQL call.
    //    Rejects anything that isn't a valid Shopify Product GID (e.g. injected query fragments).
    if (!PRODUCT_GID_REGEX.test(productId)) {
      console.warn(`Background sync rejected: invalid productId format "${productId}"`);
      return;
    }

    const currentCount = await db.product.count({
      where: { shopDomain },
    });

    if (productLimit !== null && currentCount >= productLimit) {
      console.log(`Background sync skipped: product limit (${productLimit}) reached for ${shopDomain}`);
      return;
    }

    // 2. Use GraphQL variables ($id: ID!) instead of string interpolation.
    //    Even though the GID regex above already guards against injection, variables
    //    are the correct pattern — the value is never parsed as part of the query document.
    const gqlResponse = await admin.graphql(
      `#graphql
      query GetProduct($id: ID!) {
        product(id: $id) {
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
      }`,
      { variables: { id: productId } }
    );

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

      // 3. Use upsert instead of create to handle the race condition where two concurrent
      //    requests for the same new product both pass the findUnique miss and both try to
      //    insert. The second create would throw a unique-key constraint error; upsert is
      //    idempotent and matches the pattern in app/services/products.server.js.
      await db.product.upsert({
        where: { id: productId },
        create: {
          id: productId,
          title: productData.title,
          handle: productData.handle,
          price,
          compareAtPrice,
          imageUrl,
          firstVariantId,
          shopDomain,
        },
        update: {
          title: productData.title,
          handle: productData.handle,
          price,
          compareAtPrice,
          imageUrl,
          firstVariantId,
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
    const { visitorId, productId, eventType, duration, price, customerId } = body;

    if (!visitorId || !productId || !eventType) {
      return Response.json(
        { error: "Missing fields" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 1. Validate eventType
    // Must be one of the three supported storefront interaction types: view, cart, or purchase.
    // Invalid types would otherwise bypass limits or result in zero/incorrect scoring weights.
    const allowedEventTypes = ["view", "cart", "purchase"];
    if (!allowedEventTypes.includes(eventType)) {
      return Response.json(
        { error: `Invalid eventType "${eventType}". Must be one of: ${allowedEventTypes.join(", ")}` },
        { status: 400, headers: corsHeaders }
      );
    }

    // 2. Validate productId
    // Must match the standard Shopify Product GID format to avoid DB schema index mismatches and Graphql errors.
    if (!PRODUCT_GID_REGEX.test(productId)) {
      return Response.json(
        { error: `Invalid productId format "${productId}". Must match "gid://shopify/Product/\\d+"` },
        { status: 400, headers: corsHeaders }
      );
    }

    // 3. Validate duration if present
    // Must be a non-negative number under 24 hours (86,400 seconds) to prevent garbage tracking duration inputs.
    if (duration !== undefined && duration !== null) {
      const parsedDuration = Number(duration);
      if (isNaN(parsedDuration) || parsedDuration < 0 || parsedDuration > 86400) {
        return Response.json(
          { error: "Invalid duration. Must be a non-negative number under 86400 seconds." },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // 4. Validate price if present
    // Must be a non-negative number to avoid recording negative transaction prices in database.
    if (price !== undefined && price !== null) {
      const parsedPrice = Number(price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return Response.json(
          { error: "Invalid price. Must be a non-negative number." },
          { status: 400, headers: corsHeaders }
        );
      }
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
      price: eventType === "purchase" ? (price ?? null) : null,
      customerId: customerId || null,
    });

    // Generate a signed token for this visitorId. The client stores this in
    // localStorage and must send it back on /api/gdpr requests to prove ownership.
    // This replaces the httpOnly cookie approach which is not viable in a cross-domain
    // App Proxy context — see app/utils/visitor-token.server.js for full explanation.
    const visitorToken = signVisitorId(visitorId);

    return Response.json({ success: true, visitorToken }, { headers: corsHeaders });
  } catch (error) {
    console.error("Track error:", error);
    return Response.json(
      { error: error.message || "Server error" },
      { status: 500, headers: corsHeaders }
    );
  }
};
