// File: app/shopify.server.js
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  LogSeverity,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { saveShopToDb } from "./services/shop.server.js";
import { DeliveryMethod } from "@shopify/shopify-api";
import { buildShopifyBillingConfig, BILLING_PLANS } from "./services/billing.service";

// Build the dynamically formatted plans dictionary required by Shopify Remix
const billingConfig = buildShopifyBillingConfig({
  BillingInterval: {
    Every30Days: "EVERY_30_DAYS",
  },
  BillingReplacementBehavior: {
    ApplyImmediately: "APPLY_IMMEDIATELY",
  },
});

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  logger: {
    level: LogSeverity.Debug,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),

  // Configure app billing profiles
  billing: billingConfig,

  // Save shop info to database after authentication
  afterAuth: async ({ session }) => {
    await saveShopToDb({
      shop: session.shop,
      accessToken: session.accessToken,
      scope: session.scope
    });

    console.log("✅ Shop saved:", session.shop);
  },

  // Declarative Webhook Handlers
  webhooks: {
    APP_SUBSCRIPTIONS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      callback: async (topic, shop, body) => {
        const payload = JSON.parse(body);
        const subscription = payload.appSubscription;
        console.log(`Webhook received [${topic}] for ${shop}`);

        if (prisma.billingSubscription) {
          // Sync changes cleanly out-of-band to prevent state drift
          await prisma.billingSubscription.upsert({
            where: { id: subscription.admin_graphql_api_id },
            create: {
              id: subscription.admin_graphql_api_id,
              shopId: shop,
              shopifySubscriptionId: subscription.admin_graphql_api_id,
              planKey: subscription.name.toUpperCase(),
              status: subscription.status,
            },
            update: {
              status: subscription.status,
            },
          });
        }
      },
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
