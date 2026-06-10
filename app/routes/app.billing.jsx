import { boundary } from "@shopify/shopify-app-react-router/server";
import { useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import {
  BILLING_PLAN_KEYS,
  BILLING_PLANS,
  PAID_PLAN_NAMES,
  getPlanByName,
} from "../services/billing.service";
import { resolveTenant } from "../services/tenant.service.js";

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const shop = await resolveTenant(session);
  const billingSubscriptionRepo = db.billingSubscription;
  const isBillingTest =
    globalThis.process?.env?.SHOPIFY_BILLING_TEST !== "false";
  const billingCheck = await billing.check({
    plans: PAID_PLAN_NAMES,
    isTest: isBillingTest,
  });
  const activeSubscription = billingCheck.appSubscriptions.find(
    (subscription) => subscription.status === "ACTIVE",
  );
  const activePaidPlan = activeSubscription
    ? getPlanByName(activeSubscription.name)
    : null;
  const activePlanKey = activePaidPlan?.key ?? BILLING_PLAN_KEYS.FREE;
  const activePlan = BILLING_PLANS[activePlanKey];

  if (activeSubscription && activePaidPlan && billingSubscriptionRepo) {
    await billingSubscriptionRepo.upsert({
      where: { id: activeSubscription.id },
      create: {
        id: activeSubscription.id,
        shopId: shop.id,
        shopifySubscriptionId: activeSubscription.id,
        planKey: activePaidPlan.key,
        status: activeSubscription.status,
        currentPeriodEndsAt: activeSubscription.currentPeriodEnd
          ? new Date(activeSubscription.currentPeriodEnd)
          : null,
      },
      update: {
        planKey: activePaidPlan.key,
        status: activeSubscription.status,
        currentPeriodEndsAt: activeSubscription.currentPeriodEnd
          ? new Date(activeSubscription.currentPeriodEnd)
          : null,
      },
    });
  } else if (billingSubscriptionRepo) {
    await billingSubscriptionRepo.updateMany({
      where: { shopId: shop.id, status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });
  }

  return {
    plans: Object.values(BILLING_PLANS),
    activePlanKey,
    activePlanName: activePlan.name,
    shopDomain: session.shop,
    host: url.searchParams.get("host"),
  };
};

function formatPrice(amount) {
  if (amount === 0) return "Free";
  return `$${amount.toFixed(2)}`;
}

function PlanCard({ plan, isActive, isFeatured, subscribeUrl }) {
  return (
    <div style={{ height: "100%" }}>
      <Card padding="0">
        <BlockStack gap="0">
          {isFeatured ? (
            <Box background="bg-surface-info" padding="300">
              <Text as="p" variant="bodySm" fontWeight="semibold" alignment="center">
                Most popular
              </Text>
            </Box>
          ) : (
            <Box minHeight="36px" />
          )}

          <Box padding="500">
            <BlockStack gap="500">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" gap="200">
                  <Text as="h2" variant="headingLg">
                    {plan.name}
                  </Text>
                  {isActive ? <Badge tone="success">Current plan</Badge> : null}
                </InlineStack>

                <Text as="p" variant="bodyMd" tone="subdued">
                  {plan.description}
                </Text>
              </BlockStack>

              <BlockStack gap="100">
                <InlineStack gap="100" blockAlign="end">
                  <Text as="p" variant="heading2xl">
                    {formatPrice(plan.amount)}
                  </Text>
                  {plan.amount > 0 ? (
                    <Box paddingBlockEnd="100">
                      <Text as="span" variant="bodyMd" tone="subdued">
                        / month
                      </Text>
                    </Box>
                  ) : null}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {plan.amount > 0
                    ? `Billed every 30 days in ${plan.currencyCode}.`
                    : "No Shopify charge required."}
                  {plan.trialDays > 0 ? ` Includes a ${plan.trialDays}-day free trial.` : ""}
                </Text>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  What&apos;s included
                </Text>
                <BlockStack gap="200">
                  {plan.features.map((feature) => (
                    <InlineStack key={feature} gap="200" blockAlign="start" wrap={false}>
                      <Box>
                        <Icon source={CheckIcon} tone="success" />
                      </Box>
                      <Text as="p" variant="bodyMd">
                        {feature}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>

              <Box paddingBlockStart="200">
                {isActive ? (
                  <Button disabled fullWidth>
                    Current plan
                  </Button>
                ) : (
                  <Button
                    fullWidth
                    variant={isFeatured ? "primary" : "secondary"}
                    url={subscribeUrl}
                  >
                    {plan.amount === 0 ? "Use Free plan" : `Upgrade to ${plan.name}`}
                  </Button>
                )}
              </Box>
            </BlockStack>
          </Box>
        </BlockStack>
      </Card>
    </div>
  );
}

export default function Billing() {
  const loaderData = useLoaderData();

  const getSubscribeUrl = (planKey) => {
    const params = new URLSearchParams({ plan: planKey, embedded: "1" });
    const host =
      loaderData.host ||
      (typeof window !== "undefined"
        ? window.btoa(`${loaderData.shopDomain}/admin`)
        : null);

    if (host) params.set("host", host);

    return `/app/billing/subscribe?${params.toString()}`;
  };

  return (
    <Page
      title="Billing"
      subtitle="Choose the plan that fits your product recommendation needs."
      narrowWidth={false}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner title={`You're on the ${loaderData.activePlanName} plan`} tone="info">
              <p>
                Upgrade anytime to unlock more product sync capacity, visitor tracking,
                and recommendation impressions.
              </p>
            </Banner>

            <InlineGrid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }} gap="400">
              {loaderData.plans.map((plan) => (
                <PlanCard
                  key={plan.key}
                  plan={plan}
                  isActive={loaderData.activePlanKey === plan.key}
                  isFeatured={plan.key === BILLING_PLAN_KEYS.PRO}
                  subscribeUrl={getSubscribeUrl(plan.key)}
                />
              ))}
            </InlineGrid>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
