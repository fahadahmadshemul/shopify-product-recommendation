import { authenticate } from "../shopify.server";
import { saveActivity } from "../services/tracker.server.js";
import db from "../db.server";

// CORS headers for preflight requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

    // Auto-sync the product if it does not exist in our cache database
    const exists = await db.product.findUnique({
      where: { id: productId },
    });

    if (!exists && admin) {
      try {
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
              featuredImage {
                url
              }
            }
          }
        `);

        const gqlData = await gqlResponse.json();
        const productData = gqlData.data?.product;

        if (productData) {
          const price = parseFloat(productData.priceRangeV2.minVariantPrice.amount);
          const imageUrl = productData.featuredImage ? productData.featuredImage.url : null;

          await db.product.create({
            data: {
              id: productId,
              title: productData.title,
              handle: productData.handle,
              price,
              imageUrl,
              shopDomain,
            },
          });
          console.log(`Auto-synced missing product: ${productId}`);
        }
      } catch (err) {
        console.error("Error auto-syncing missing product:", err);
      }
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
      { error: "Server error" },
      { status: 500, headers: corsHeaders }
    );
  }
};
