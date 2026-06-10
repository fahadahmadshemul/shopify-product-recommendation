import db from "../db.server";

export async function saveActivity({ visitorId, shopDomain, productId, eventType, duration }) {
  return await db.visitorActivity.create({
    data: {
      visitorId,
      shopDomain,
      productId,
      eventType, //"view", "cart", "purchase"
      duration: duration ?? null,
    },
  });
}
