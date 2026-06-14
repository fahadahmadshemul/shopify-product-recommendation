import db from "../db.server";
import { BILLING_PLANS, BILLING_PLAN_KEYS } from "./billing.service";

export async function getActivePlanKey(shopDomain) {
  const shop = await db.shop.findUnique({
    where: { shop: shopDomain },
    include: {
      subscriptions: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (shop && shop.subscriptions.length > 0) {
    const planKey = shop.subscriptions[0].planKey;
    if (BILLING_PLANS[planKey]) return planKey;
  }

  return BILLING_PLAN_KEYS.FREE;
}

export async function getActivePlan(shopDomain) {
  const planKey = await getActivePlanKey(shopDomain);
  return BILLING_PLANS[planKey] || BILLING_PLANS[BILLING_PLAN_KEYS.FREE];
}

export async function getMonthlyRecommendationCount(shopDomain) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  return db.recommendation.count({
    where: {
      shopDomain,
      createdAt: { gte: startOfMonth },
    },
  });
}

export async function checkRecommendationLimit(shopDomain) {
  const plan = await getActivePlan(shopDomain);
  const limit = plan.limits.recommendations;
  const used = await getMonthlyRecommendationCount(shopDomain);

  const allowed = limit === null || used < limit;
  const remaining = limit === null ? Infinity : Math.max(0, limit - used);

  return { allowed, limit, used, remaining, planName: plan.name, planKey: plan.key };
}
