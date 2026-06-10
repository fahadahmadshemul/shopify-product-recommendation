import { saveActivity } from "../services/tracker.server.js";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// OPTIONS request handle করো (preflight)
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
    const body = await request.json();
    const { visitorId, shopDomain, productId, eventType, duration } = body;

    if (!visitorId || !shopDomain || !productId || !eventType) {
      return Response.json(
        { error: "Missing fields" },
        { status: 400, headers: corsHeaders },
      );
    }

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
      { status: 500, headers: corsHeaders },
    );
  }
};
