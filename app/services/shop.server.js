import db from "../db.server.js";

export async function saveShopToDb(shop, accessToken, scope) {
  const token = accessToken ?? null;
  return await db.shop.upsert({
    where: { shop },
    update: { accessToken: token, scope, isActive: true },
    create: { shop, accessToken: token, scope },
  });
}
