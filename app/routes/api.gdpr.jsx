import { authenticate } from "../shopify.server";
import db from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { session } = await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const visitorId = url.searchParams.get("visitorId");
    const shopDomain = session ? session.shop : url.searchParams.get("shop");

    if (!shopDomain || !visitorId) {
      return Response.json(
        { error: "Missing shop or visitorId" },
        { status: 400, headers: corsHeaders }
      );
    }

    const activities = await db.visitorActivity.findMany({
      where: { shopDomain, visitorId },
    });

    const recommendations = await db.recommendation.findMany({
      where: { shopDomain, visitorId },
    });

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
      const shopDomain = session ? session.shop : url.searchParams.get("shop");

      if (!shopDomain || !visitorId) {
        return Response.json(
          { error: "Missing shop or visitorId" },
          { status: 400, headers: corsHeaders }
        );
      }

      const deletedActivities = await db.visitorActivity.deleteMany({
        where: { shopDomain, visitorId },
      });

      const deletedRecommendations = await db.recommendation.deleteMany({
        where: { shopDomain, visitorId },
      });

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
