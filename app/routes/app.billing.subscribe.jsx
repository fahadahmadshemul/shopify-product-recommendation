import { authenticate } from "../shopify.server";
import {
  getPlan,
  BILLING_PLAN_KEYS,
  PAID_PLAN_NAMES,
  PAID_PLAN_KEYS,
} from "../services/billing.service";
import db from "../db.server";
import { resolveTenant } from "../services/tenant.service.js";

export const action = async ({ request }) => {
  const { billing, redirect, session } = await authenticate.admin(request);
  const shop = await resolveTenant(session);

  const formData = await request.formData();
  const planKey = formData.get("plan");
  const url = new URL(request.url);
  const host = url.searchParams.get("host");

  const plan = getPlan(planKey);
  const isBillingTest =
    globalThis.process?.env?.SHOPIFY_BILLING_TEST !== "false";

  // Handle Free plan downgrade
  if (plan.key === BILLING_PLAN_KEYS.FREE) {
    const billingCheck = await billing.check({
      plans: PAID_PLAN_KEYS,
      isTest: isBillingTest,
    });
    const activeSubscription = billingCheck.appSubscriptions.find(
      (subscription) => subscription.status === "ACTIVE",
    );

    if (activeSubscription) {
      await billing.cancel({
        subscriptionId: activeSubscription.id,
        isTest: isBillingTest,
      });

      const billingSubscriptionRepo = db.billingSubscription;
      if (billingSubscriptionRepo) {
        await billingSubscriptionRepo.updateMany({
          where: { shopId: shop.id, status: "ACTIVE" },
          data: { status: "CANCELLED" },
        });
      }
    }

    const redirectUrl = new URL(`${process.env.SHOPIFY_APP_URL}/app/billing`);
    if (host) {
      redirectUrl.searchParams.set("host", host);
    }
    return redirect(redirectUrl.pathname + redirectUrl.search);
  }

  // Handle Paid plan upgrade
  const returnUrl = new URL(
    `${process.env.SHOPIFY_APP_URL}/app/billing/success`,
  );
  returnUrl.searchParams.set("shop", session.shop);
  if (host) {
    returnUrl.searchParams.set("host", host);
    returnUrl.searchParams.set("embedded", "1");
  }

  try {
    await billing.request({
      plan: plan.key,
      isTest: isBillingTest,
      returnUrl: returnUrl.toString(),
    });
  } catch (responseOrError) {
    if (responseOrError instanceof Response) {
      const location = responseOrError.headers.get("location");
      const reauthUrl = responseOrError.headers.get(
        "X-Shopify-API-Request-Failure-Reauthorize-Url",
      );

      let targetUrl = reauthUrl || location;
      if (targetUrl) {
        if (targetUrl.includes("exitIframe=")) {
          const parsedUrl = new URL(targetUrl, process.env.SHOPIFY_APP_URL);
          const exitIframeUrl = parsedUrl.searchParams.get("exitIframe");
          if (exitIframeUrl) {
            targetUrl = exitIframeUrl;
          }
        }
        return Response.json({ confirmationUrl: targetUrl });
      }
    }
    throw responseOrError;
  }
};

export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  const url = new URL(request.url);
  const host = url.searchParams.get("host");

  // Redirect GET requests safely back to the billing page to avoid session loss/login loop issues
  const redirectUrl = new URL(`${process.env.SHOPIFY_APP_URL}/app/billing`);
  if (host) {
    redirectUrl.searchParams.set("host", host);
  }
  return redirect(redirectUrl.pathname + redirectUrl.search);
};