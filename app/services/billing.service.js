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
