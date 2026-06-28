import { authenticate } from "../shopify.server";
import db from "../db.server";
import { verifyVisitorToken } from "../utils/visitor-token.server.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Validate a request's visitorId against its visitorToken.
 *
 * The token is an HMAC-SHA256 signature of the visitorId, signed with SHOPIFY_API_SECRET.
 * Clients obtain it from the /api/track response and store it in localStorage.
 *
 * FALLBACK: If no token is provided (e.g. legacy request or cookie-not-present scenario),
 * we reject with 401 so the caller knows they need to call /api/track first to get a token.
 *
 * Legitimate browser flows (tracker.js GDPR opt-out) always have the token available
 * because a track() call is always made before the opt-out DELETE is triggered.
 */
function validateToken(visitorId, visitorToken) {
  if (!visitorToken) {
    return {
      valid: false,
      error: "Missing visitorToken. Call /api/track first to obtain a signed token.",
    };
  }
  if (!verifyVisitorToken(visitorId, visitorToken)) {
    return { valid: false, error: "Invalid visitorToken — unauthorized." };
  }
  return { valid: true };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { session } = await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const visitorId = url.searchParams.get("visitorId");
    const visitorToken = url.searchParams.get("visitorToken");
    const shopDomain = session ? session.shop : url.searchParams.get("shop");

    if (!shopDomain || !visitorId) {
      return Response.json(
        { error: "Missing shop or visitorId" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify that the caller owns this visitorId via a signed token.
    // Without this check, any client knowing or guessing a visitorId string
    // could read another visitor's full activity history.
    const tokenCheck = validateToken(visitorId, visitorToken);
    if (!tokenCheck.valid) {
      return Response.json(
        { error: tokenCheck.error },
        { status: 401, headers: corsHeaders }
      );
    }

    const [activities, recommendations] = await Promise.all([
      db.visitorActivity.findMany({ where: { shopDomain, visitorId } }),
      db.recommendation.findMany({ where: { shopDomain, visitorId } }),
    ]);

    return Response.json(
      {
        visitorId,
        visitorActivities: activities,
        recommendations,
        activityCount: activities.length,
        recommendationCount: recommendations.length,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("GDPR data request error:", error);
    return Response.json(
      { error: error.message || "Server error" },
      { status: 500, headers: corsHeaders }
    );
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === "DELETE") {
    try {
      const { session } = await authenticate.public.appProxy(request);
      const url = new URL(request.url);
      const visitorId = url.searchParams.get("visitorId");
      const visitorToken = url.searchParams.get("visitorToken");
      const shopDomain = session ? session.shop : url.searchParams.get("shop");

      if (!shopDomain || !visitorId) {
        return Response.json(
          { error: "Missing shop or visitorId" },
          { status: 400, headers: corsHeaders }
        );
      }

      // Verify token before allowing any data deletion.
      // Without this check, anyone knowing a visitorId (predictable format) could
      // permanently erase another visitor's recommendation history.
      const tokenCheck = validateToken(visitorId, visitorToken);
      if (!tokenCheck.valid) {
        return Response.json(
          { error: tokenCheck.error },
          { status: 401, headers: corsHeaders }
        );
      }

      const [deletedActivities, deletedRecommendations] = await Promise.all([
        db.visitorActivity.deleteMany({ where: { shopDomain, visitorId } }),
        db.recommendation.deleteMany({ where: { shopDomain, visitorId } }),
      ]);

      console.log(
        `Manual GDPR deletion for visitor ${visitorId}: ` +
        `${deletedActivities.count} activities, ${deletedRecommendations.count} recommendations`
      );

      return Response.json(
        {
          success: true,
          deletedActivities: deletedActivities.count,
          deletedRecommendations: deletedRecommendations.count,
        },
        { headers: corsHeaders }
      );
    } catch (error) {
      console.error("GDPR deletion error:", error);
      return Response.json(
        { error: error.message || "Server error" },
        { status: 500, headers: corsHeaders }
      );
    }
  }

  return Response.json(
    { error: "Method not allowed" },
    { status: 405, headers: corsHeaders }
  );
};
