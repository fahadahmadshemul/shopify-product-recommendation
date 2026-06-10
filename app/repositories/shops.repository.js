import db from "../db.server";

/**
 * Upserts a shop record in the database
 */
export async function upsertShop(shopDomain, data = {}) {
  return db.shop.upsert({
    where: { shopDomain },
    update: { ...data, uninstalledAt: null },
    create: { shopDomain, ...data },
  });
}

/**
 * Retrieves a shop record by its domain name
 */
export async function getShopByDomain(shopDomain) {
  return db.shop.findUnique({ where: { shopDomain } });
}

/**
 * Updates whether storefront expiry visibility is enabled for a shop
 */
export async function updateStorefrontExpiryEnabled(shopId, enabled) {
  return db.shop.update({
    where: { id: shopId },
    data: { storefrontExpiryEnabled: enabled },
  });
}

/**
 * Returns a list of all active shops
 */
export async function listActiveShops() {
  return db.shop.findMany({
    where: { uninstalledAt: null },
    select: { id: true, shopDomain: true },
    orderBy: { shopDomain: "asc" },
  });
}

/**
 * Marks a shop as uninstalled
 */
export async function markShopUninstalled(shopDomain) {
  return db.shop.updateMany({
    where: { shopDomain },
    data: { uninstalledAt: new Date() },
  });
}
