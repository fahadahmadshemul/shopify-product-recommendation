import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request, params }) => {
  const { shop, session, payload, topic } = await authenticate.webhook(request);
  console.log(`Received GDPR webhook ${topic} for ${shop}`);

  if (topic === "CUSTOMERS_DATA_REQUEST") {
    // Article 15 - Export visitor data for the requested customer
    const customerId = payload.customer?.id;
    if (!customerId) return new Response(null, { status: 200 });

    const activities = await db.visitorActivity.findMany({
      where: {
        shopDomain: shop,
        visitorId: customerId,
      },
    });

    const recommendations = await db.recommendation.findMany({
      where: {
        shopDomain: shop,
        visitorId: customerId,
      },
    });

    const exportData = {
      customerId,
      shop,
      visitorActivities: activities,
      recommendations,
    };

    console.log(`GDPR Data Export for customer ${customerId}:`, JSON.stringify(exportData, null, 2));
    return new Response(null, { status: 200 });
  }

  if (topic === "CUSTOMERS_REDACT") {
    // Article 17 - Delete all data for the requested customer
    const customerId = payload.customer?.id;
    if (!customerId) return new Response(null, { status: 200 });

    const deletedActivities = await db.visitorActivity.deleteMany({
      where: {
        shopDomain: shop,
        visitorId: customerId,
      },
    });

    const deletedRecommendations = await db.recommendation.deleteMany({
      where: {
        shopDomain: shop,
        visitorId: customerId,
      },
    });

    console.log(
      `GDPR Redacted customer ${customerId} for ${shop}: ` +
      `${deletedActivities.count} activities, ${deletedRecommendations.count} recommendations`
    );

    return new Response(null, { status: 200 });
  }

  if (topic === "SHOP_REDACT") {
    // Full shop data purge
    const deletedActivities = await db.visitorActivity.deleteMany({
      where: { shopDomain: shop },
    });

    const deletedRecommendations = await db.recommendation.deleteMany({
      where: { shopDomain: shop },
    });

    const deletedProducts = await db.product.deleteMany({
      where: { shopDomain: shop },
    });

    console.log(
      `GDPR Shop Redact for ${shop}: ` +
      `${deletedActivities.count} activities, ${deletedRecommendations.count} recommendations, ${deletedProducts.count} products`
    );

    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 200 });
};
