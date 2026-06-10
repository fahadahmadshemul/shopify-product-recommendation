import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  //delete shop from database
  if (topic === "APP_UNINSTALLED") {
    await db.shop.update({
      where: { shop },
      data: { isActive: false, accessToken: null },
    });

    console.log("❌ Uninstalled:", shop);
  }

  return new Response();
};
