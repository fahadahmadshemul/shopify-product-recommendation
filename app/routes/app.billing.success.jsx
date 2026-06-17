import { Page, Card, Text, Button, BlockStack } from "@shopify/polaris";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { resolveTenant } from "../services/tenant.service.js";
import {
  BILLING_PLAN_KEYS,
  BILLING_PLANS,
  PAID_PLAN_NAMES,
  PAID_PLAN_KEYS,
  getPlanByName,
} from "../services/billing.service";

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const [shop, billingResult] = await Promise.all([
    resolveTenant(session),
    billing.check({
      plans: PAID_PLAN_KEYS,
      isTest: globalThis.process?.env?.SHOPIFY_BILLING_TEST !== "false",
    }),
  ]);

  const activeSubscription = billingResult.appSubscriptions.find(
    (subscription) => subscription.status === "ACTIVE",
  );

  const activePaidPlan = activeSubscription
    ? getPlanByName(activeSubscription.name)
    : null;

  const activePlanKey = activePaidPlan?.key ?? BILLING_PLAN_KEYS.FREE;
  const activePlan = BILLING_PLANS[activePlanKey];

  const billingSubscriptionRepo = db.billingSubscription;
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
  } else if (billingSubscriptionRepo) {
    await billingSubscriptionRepo.updateMany({
      where: { shopId: shop.id, status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });
  }

  return {
    activePlanName: activePlan.name,
    host: url.searchParams.get("host"),
  };
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function BillingSuccess() {
  const { activePlanName, host } = useLoaderData();

  const dashboardUrl = `/app?host=${host ? encodeURIComponent(host) : ""}`;

  return (
    <Page title="Payment Successful" narrowWidth>
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            🎉 Subscription Activated!
          </Text>

          <Text as="p">
            Your plan (<strong>{activePlanName}</strong>) is now active. You can start using all features.
          </Text>

          <Button url={dashboardUrl} variant="primary">
            Go to Dashboard
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}