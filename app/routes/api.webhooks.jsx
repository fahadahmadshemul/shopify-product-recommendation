import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getPlanByName } from "../services/billing.service";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received API Webhook ${topic} for ${shop}`);

  if (topic === "APP_SUBSCRIPTIONS_UPDATE") {
    const subscription = payload.app_subscription || payload.appSubscription;
    console.log(`Processing subscription update webhook for ${shop}:`, subscription);

    if (db.billingSubscription) {
      const shopRecord = await db.shop.findUnique({
        where: { shop },
        select: { id: true },
      });

      if (!shopRecord) {
        console.error(`Shop not found for webhook: ${shop}`);
        return new Response("Shop not found", { status: 404 });
      }

      const activePaidPlan = getPlanByName(subscription.name);
      const planKey = activePaidPlan ? activePaidPlan.key : subscription.name.toUpperCase();

      await db.billingSubscription.upsert({
        where: { id: subscription.admin_graphql_api_id },
        create: {
          id: subscription.admin_graphql_api_id,
          shopId: shopRecord.id,
          shopifySubscriptionId: subscription.admin_graphql_api_id,
          planKey: planKey,
          status: subscription.status,
          trialEndsAt: subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null,
          currentPeriodEndsAt: subscription.current_period_end ? new Date(subscription.current_period_end) : null,
        },
        update: {
          planKey: planKey,
          status: subscription.status,
          trialEndsAt: subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null,
          currentPeriodEndsAt: subscription.current_period_end ? new Date(subscription.current_period_end) : null,
        },
      });
      console.log(`Successfully upserted BillingSubscription for ${shop}`);
    }
  }

  return new Response();
};
