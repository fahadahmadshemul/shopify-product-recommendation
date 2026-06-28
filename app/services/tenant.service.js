
import db from "../db.server.js";

/**
 * Resolves the tenant (shop) based on the current admin session.
 * Ensures a shop row exists so downstream billing writes can use shop.id.
 */
export async function resolveTenant(session) {
  return db.shop.upsert({
    where: { shop: session.shop },
    update: {
      accessToken: session.accessToken ?? null,
      scope: session.scope ?? "",
      isActive: true,
    },
    create: {
      shop: session.shop,
      accessToken: session.accessToken ?? null,
      scope: session.scope ?? "",
      isActive: true,
    },
  });
}
