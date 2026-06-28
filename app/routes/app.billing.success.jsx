import { Page, Card, Text, Button, BlockStack } from "@shopify/polaris";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { resolveTenant } from "../services/tenant.service.js";
import { resolveActivePlan } from "../services/billing.service";

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const [, { plan: activePlan }] = await Promise.all([
    resolveTenant(session),
    resolveActivePlan(session.shop, billing),
  ]);

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