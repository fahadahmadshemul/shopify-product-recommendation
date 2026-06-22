import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import "@shopify/polaris/build/esm/styles.css";
import { authenticate } from "../shopify.server";
import { useState } from "react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Box, Banner } from "@shopify/polaris";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const isPlanPurchased =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("charge_id");
  const [showBanner, setShowBanner] = useState(isPlanPurchased);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <a href="/app">Home</a>
        <a href="/app/products">Products</a>
        <a href="/app/settings">Widget</a>
        <a href="/app/billing">Billing</a>
      </NavMenu>
      <PolarisAppProvider i18n={enTranslations}>
        {showBanner && (
          <Box paddingBlockEnd="400" paddingInline="400">
            <Banner
              title="🎉 Subscription Activated"
              tone="success"
              onDismiss={() => setShowBanner(false)}
            >
              <p>
                Thank you for subscribing! Your payment was successful and your
                premium features are now unlocked.
              </p>
            </Banner>
          </Box>
        )}
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
