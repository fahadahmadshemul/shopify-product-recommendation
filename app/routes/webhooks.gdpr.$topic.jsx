import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received GDPR webhook ${topic} for ${shop}`);

  if (topic === "CUSTOMERS_DATA_REQUEST") {
    // Article 15 - Export visitor data for the requested customer
    const customerId = payload.customer?.id;
    if (!customerId) return new Response(null, { status: 200 });

    const customerIdStr = String(customerId);

    // Query visitor activities by customerId instead of visitorId.
    // Note: Any VisitorActivity rows from anonymous (never-logged-in) sessions
    // genuinely have no customerId, which is expected by design since no customer record
    // exists to request or redact.
    const activities = await db.visitorActivity.findMany({
      where: {
        shopDomain: shop,
        customerId: customerIdStr,
      },
    });

    // To find recommendations, we lookup by any visitorIds associated with this customer
    const visitorIds = [...new Set(activities.map((a) => a.visitorId))];

    const recommendations = visitorIds.length > 0
      ? await db.recommendation.findMany({
          where: {
            shopDomain: shop,
            visitorId: { in: visitorIds },
          },
        })
      : [];

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

    const customerIdStr = String(customerId);

    // Get visitorIds first before deleting visitor activities, so we can clean up recommendations
    // Note: Anonymous sessions are left untouched as they have no linked customerId.
    const activities = await db.visitorActivity.findMany({
      where: {
        shopDomain: shop,
        customerId: customerIdStr,
      },
      select: { visitorId: true },
    });

    const visitorIds = [...new Set(activities.map((a) => a.visitorId))];

    const deletedActivities = await db.visitorActivity.deleteMany({
      where: {
        shopDomain: shop,
        customerId: customerIdStr,
      },
    });

    let deletedRecommendationsCount = 0;
    if (visitorIds.length > 0) {
      const deletedRecommendations = await db.recommendation.deleteMany({
        where: {
          shopDomain: shop,
          visitorId: { in: visitorIds },
        },
      });
      deletedRecommendationsCount = deletedRecommendations.count;
    }

    console.log(
      `GDPR Redacted customer ${customerId} for ${shop}: ` +
      `${deletedActivities.count} activities, ${deletedRecommendationsCount} recommendations`
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
