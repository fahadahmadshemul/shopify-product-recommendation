import { useEffect } from "react";
import PropTypes from "prop-types";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useLoaderData, useFetcher, useRouteError } from "react-router";
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
  resolveActivePlan,
} from "../services/billing.service";
import { resolveTenant } from "../services/tenant.service.js";

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const [shop, { planKey: activePlanKey, plan: activePlan }] = await Promise.all([
    resolveTenant(session),
    resolveActivePlan(session.shop, billing),
  ]);

  const billingSubscriptionRepo = db.billingSubscription;
  const trialInfo = await billingSubscriptionRepo?.findFirst({
    where: { shopId: shop.id, status: "ACTIVE" },
    select: { trialEndsAt: true, status: true },
  });

  return {
    plans: Object.values(BILLING_PLANS),
    activePlanKey,
    activePlanName: activePlan.name,
    shopDomain: session.shop,
    host: url.searchParams.get("host"),
    trialEndsAt: trialInfo?.trialEndsAt || null,
  };
};

function formatPrice(amount) {
  if (amount === 0) return "Free";
  return `$${amount.toFixed(2)}`;
}

function PlanCard({ plan, isActive, isFeatured, actionUrl }) {
  PlanCard.propTypes = {
    plan: PropTypes.shape({
      name: PropTypes.string.isRequired,
      description: PropTypes.string.isRequired,
      amount: PropTypes.number.isRequired,
      currencyCode: PropTypes.string.isRequired,
      trialDays: PropTypes.number.isRequired,
      features: PropTypes.arrayOf(PropTypes.string).isRequired,
      key: PropTypes.string.isRequired,
    }).isRequired,
    isActive: PropTypes.bool.isRequired,
    isFeatured: PropTypes.bool.isRequired,
    actionUrl: PropTypes.string.isRequired,
  };

  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.data?.confirmationUrl) {
      window.open(fetcher.data.confirmationUrl, "_top");
    }
  }, [fetcher.data]);

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
                  <fetcher.Form method="post" action={actionUrl} style={{ width: "100%" }}>
                    <input type="hidden" name="plan" value={plan.key} />
                    <Button
                      submit
                      loading={fetcher.state !== "idle"}
                      fullWidth
                      variant={isFeatured ? "primary" : "secondary"}
                    >
                      {plan.amount === 0 ? "Use Free plan" : `Upgrade to ${plan.name}`}
                    </Button>
                  </fetcher.Form>
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

  const isInTrial = loaderData.trialEndsAt && new Date(loaderData.trialEndsAt) > new Date();
  const trialDaysLeft = isInTrial
    ? Math.ceil((new Date(loaderData.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  const getActionUrl = () => {
    const params = new URLSearchParams();
  
    if (loaderData.host) {
      params.set("host", loaderData.host);
    }
  
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
          <Box paddingInline={{ xs: "400", md: "0" }}>
          <BlockStack gap="500">
            {isInTrial && (
              <Banner
                title={`Free trial: ${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""} remaining`}
                tone="warning"
              >
                <p>
                  Your {loaderData.activePlanName} plan has a {trialDaysLeft}-day free trial. 
                  You won&apos;t be charged until the trial ends.
                  {trialDaysLeft <= 2 && " Your trial is ending soon — choose a plan to continue using premium features."}
                </p>
              </Banner>
            )}

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
                  actionUrl={getActionUrl()}
                />
              ))}
            </InlineGrid>
          </BlockStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
