import db from "../db.server.js";

export async function saveShopToDb(shop, accessToken, scope) {
  return await db.shop.upsert({
    where: { shop },
    update: { accessToken, scope, isActive: true },
    create: { shop, accessToken, scope },
  })
}
