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
    description: "Try personalized recommendations on a small catalog.",
    limits: { products: 50, analytics: false, recommendations: 100 },
    features: [
      "Sync up to 50 products",
      "Basic visitor activity tracking",
      "Up to 100 recommendation impressions / month",
      "Storefront visitor tracker extension",
    ],
  },
  [BILLING_PLAN_KEYS.BASIC]: {
    key: BILLING_PLAN_KEYS.BASIC,
    name: "Basic",
    amount: 7.99,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 7,
    description: "Grow conversions with smarter product suggestions.",
    limits: { products: 500, analytics: false, recommendations: 10000 },
    features: [
      "Sync up to 500 products",
      "View, cart, and purchase event tracking",
      "Up to 10,000 recommendation impressions / month",
      "Automated product sync",
      "7-day free trial",
    ],
  },
  [BILLING_PLAN_KEYS.PRO]: {
    key: BILLING_PLAN_KEYS.PRO,
    name: "Pro",
    amount: 13.99,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 7,
    description: "Unlimited scale with advanced recommendation analytics.",
    limits: { products: null, analytics: true, recommendations: null },
    features: [
      "Unlimited product sync",
      "Unlimited recommendation impressions",
      "Advanced visitor analytics",
      "Priority recommendation scoring",
      "7-day free trial",
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
