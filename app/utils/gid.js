/**
 * Extracts the numeric ID from a Shopify GID string.
 * e.g., "gid://shopify/ProductVariant/45678901234" → "45678901234"
 */
export function extractNumericGid(gid) {
  if (!gid) return null;
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : gid;
}
