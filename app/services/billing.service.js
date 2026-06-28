import db from "../db.server";

export const BILLING_PLAN_KEYS = {
  FREE: "FREE",
  BASIC: "BASIC",
  PRO: "PRO",
};

export const BILLING_PLANS = {
  [BILLING_PLAN_KEYS.FREE]: {
    key: BILLING_PLAN_KEYS.FREE,
    name: "Free",
    amount: 0,
    currencyCode: "USD",
    interval: null,
    trialDays: 0,
    description: "Try recommendations on a small catalog — no charge, no time limit.",
    limits: { products: 50, analytics: false, recommendations: 500 },
    features: [
      "Sync up to 50 products",
      "Visitor activity tracking (views & carts)",
      "Up to 500 recommendation impressions / month",
      "Storefront recommendation widget",
      "No credit card required",
    ],
  },
  [BILLING_PLAN_KEYS.BASIC]: {
    key: BILLING_PLAN_KEYS.BASIC,
    name: "Basic",
    amount: 9.99,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 14,
    description: "Grow conversions with smarter product suggestions for small catalogs.",
    limits: { products: 1000, analytics: false, recommendations: 25000 },
    features: [
      "Sync up to 1000 products",
      "Full event tracking (views, carts, purchases)",
      "Up to 25,000 recommendation impressions / month",
      "Automated product sync from Shopify",
      "14-day free trial — cancel anytime",
    ],
  },
  [BILLING_PLAN_KEYS.PRO]: {
    key: BILLING_PLAN_KEYS.PRO,
    name: "Pro",
    amount: 39.99,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 14,
    description: "Unlimited scale with advanced analytics and priority scoring.",
    limits: { products: null, analytics: true, recommendations: null },
    features: [
      "Unlimited product sync",
      "Unlimited recommendation impressions",
      "Advanced visitor analytics dashboard",
      "Priority recommendation scoring (1.5× boost)",
      "Unique visitor & session metrics",
      "14-day free trial — cancel anytime",
      "Priority support",
    ],
  },
};

export const PAID_BILLING_PLANS = Object.fromEntries(
  Object.entries(BILLING_PLANS).filter(([, plan]) => plan.amount > 0),
);

export const PAID_PLAN_NAMES = Object.values(PAID_BILLING_PLANS).map(
  (plan) => plan.name,
);

export const PAID_PLAN_KEYS = Object.keys(PAID_BILLING_PLANS);

export function getPlan(planKey) {
  const plan = BILLING_PLANS[planKey];
  if (!plan) throw new Error("Unknown billing plan.");
  return plan;
}

export function getPlanByName(planName) {
  const upperName = planName?.toUpperCase();
  return (
    Object.values(BILLING_PLANS).find(
      (plan) =>
        plan.name === planName ||
        plan.key === upperName ||
        plan.name.toUpperCase() === upperName,
    ) ?? null
  );
}

export function isFreePlan(planKey) {
  return planKey === BILLING_PLAN_KEYS.FREE;
}

export function buildShopifyBillingConfig({
  BillingInterval,
  BillingReplacementBehavior,
}) {
  return Object.fromEntries(
    Object.values(PAID_BILLING_PLANS).map((plan) => [
      plan.key,
      {
        replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
        trialDays: plan.trialDays,
        lineItems: [
          {
            amount: plan.amount,
            currencyCode: plan.currencyCode,
            interval: BillingInterval.Every30Days,
          },
        ],
      },
    ]),
  );
}

/**
 * Resolves the active billing plan for a shop with single-source-of-truth logic.
 *
 * 1. Always treats live billing.check() as source of truth when billing object is provided.
 * 2. Opportunistically upserts local DB BillingSubscription table on mismatch (self-healing cache).
 * 3. Falls back to local DB cache if live billing.check() fails/throws or if billing object is omitted.
 */
export async function resolveActivePlan(shopDomain, billing = null) {
  const isBillingTest = globalThis.process?.env?.SHOPIFY_BILLING_TEST !== "false";

  if (billing) {
    try {
      const billingResult = await billing.check({
        plans: PAID_PLAN_KEYS,
        isTest: isBillingTest,
      });

      const activeSubscription = billingResult.appSubscriptions?.find(
        (subscription) => subscription.status === "ACTIVE",
      );

      const activePaidPlan = activeSubscription
        ? getPlanByName(activeSubscription.name)
        : null;

      const activePlanKey = activePaidPlan?.key ?? BILLING_PLAN_KEYS.FREE;
      const activePlan = BILLING_PLANS[activePlanKey];

      // Opportunistically self-heal local database cache
      if (db.billingSubscription) {
        const shopRecord = await db.shop.findUnique({
          where: { shop: shopDomain },
          select: { id: true },
        });

        if (shopRecord) {
          if (activeSubscription && activePaidPlan) {
            await db.billingSubscription.upsert({
              where: { id: activeSubscription.id },
              create: {
                id: activeSubscription.id,
                shopId: shopRecord.id,
                shopifySubscriptionId: activeSubscription.id,
                planKey: activePaidPlan.key,
                status: activeSubscription.status,
                currentPeriodEndsAt: activeSubscription.currentPeriodEnd
                  ? new Date(activeSubscription.currentPeriodEnd)
                  : null,
                trialEndsAt: activeSubscription.trialEnd
                  ? new Date(activeSubscription.trialEnd)
                  : null,
              },
              update: {
                planKey: activePaidPlan.key,
                status: activeSubscription.status,
                currentPeriodEndsAt: activeSubscription.currentPeriodEnd
                  ? new Date(activeSubscription.currentPeriodEnd)
                  : null,
                trialEndsAt: activeSubscription.trialEnd
                  ? new Date(activeSubscription.trialEnd)
                  : null,
              },
            });
          } else {
            await db.billingSubscription.updateMany({
              where: { shopId: shopRecord.id, status: "ACTIVE" },
              data: { status: "CANCELLED" },
            });
          }
        }
      }

      return { planKey: activePlanKey, plan: activePlan };
    } catch (err) {
      console.warn(`Live billing.check failed for ${shopDomain}, falling back to local DB cache:`, err.message);
    }
  }

  // Fallback to local DB cache when billing is omitted or billing.check throws
  if (db.shop) {
    const shopRecord = await db.shop.findUnique({
      where: { shop: shopDomain },
      include: {
        subscriptions: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (shopRecord && shopRecord.subscriptions.length > 0) {
      const planKey = shopRecord.subscriptions[0].planKey;
      if (BILLING_PLANS[planKey]) {
        return { planKey, plan: BILLING_PLANS[planKey] };
      }
    }
  }

  return { planKey: BILLING_PLAN_KEYS.FREE, plan: BILLING_PLANS[BILLING_PLAN_KEYS.FREE] };
}
