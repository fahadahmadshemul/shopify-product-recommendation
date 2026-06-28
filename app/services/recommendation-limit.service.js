import db from "../db.server";
import { resolveActivePlan } from "./billing.service";

export async function getActivePlanKey(shopDomain, billing = null) {
  const { planKey } = await resolveActivePlan(shopDomain, billing);
  return planKey;
}

export async function getActivePlan(shopDomain, billing = null) {
  const { plan } = await resolveActivePlan(shopDomain, billing);
  return plan;
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
