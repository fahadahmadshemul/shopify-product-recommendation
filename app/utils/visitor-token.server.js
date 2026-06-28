/**
 * Utility for creating and verifying HMAC-signed visitor tokens.
 *
 * WHY NOT httpOnly COOKIES:
 * Our tracking endpoints are Shopify App Proxy routes. The tracker script runs on
 * the merchant's storefront (e.g. store.myshopify.com), but the app backend runs
 * on a separate domain. This is a cross-site (third-party) context, meaning:
 *   - Safari blocks third-party cookies entirely (ITP)
 *   - Chrome has phased out third-party cookies
 *   - Shopify's own guidelines prohibit apps from relying on third-party cookies
 *   - SameSite=None; Secure can't be set via App Proxy because the response
 *     passes through Shopify's servers, not directly to the browser
 *
 * CHOSEN APPROACH — HMAC-Signed Visitor Token:
 * Instead of cookies, we create a short HMAC-SHA256 signature of the visitorId
 * using the app's SHOPIFY_API_SECRET as the signing key. This token is returned
 * from /api/track, stored by the client in localStorage, and sent as a
 * query param on /api/gdpr requests. The server verifies the signature before
 * allowing any data access or deletion.
 *
 * SECURITY PROPERTIES:
 *   - A client cannot forge a token for an arbitrary visitorId without knowing the
 *     API secret (which only lives server-side)
 *   - Signatures are constant for a given visitorId (deterministic), so they don't
 *     need to be stored server-side — stateless verification
 *   - Tokens are scoped to a visitorId, so leaking one token doesn't compromise
 *     other visitors' data
 *
 * FALLBACK BEHAVIOR (when no token is present):
 *   On GET (data export): return 401 — caller must first call /api/track to obtain a token.
 *   On DELETE (opt-out/erasure): return 401 — same requirement.
 *   Rationale: The GDPR opt-out flow in tracker.js already sends a track event before
 *   calling DELETE /api/gdpr. So any legitimate browser flow will have a token available.
 *   Anonymous attackers guessing visitorIds will be rejected.
 *
 * REMAINING LIMITATION:
 *   localStorage can be read by any JS on the same page (XSS). Combined with HTTPS and
 *   Shopify's CSP headers, this risk is low for this use case (tracking data, not financial).
 *   For higher security needs, a server-side token rotation or expiry mechanism can be added.
 */

import { createHmac } from "crypto";

/**
 * Sign a visitorId using SHOPIFY_API_SECRET as HMAC key.
 * Returns a hex string.
 */
export function signVisitorId(visitorId) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("SHOPIFY_API_SECRET is not set");
  return createHmac("sha256", secret).update(visitorId).digest("hex");
}

/**
 * Verify that a provided token is a valid signature for the given visitorId.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyVisitorToken(visitorId, token) {
  if (!visitorId || !token) return false;
  try {
    const expected = signVisitorId(visitorId);
    // Timing-safe comparison: compare lengths first, then every byte
    if (expected.length !== token.length) return false;
    const expectedBuf = Buffer.from(expected, "hex");
    const tokenBuf = Buffer.from(token, "hex");
    if (expectedBuf.length !== tokenBuf.length) return false;
    let diff = 0;
    for (let i = 0; i < expectedBuf.length; i++) {
      diff |= expectedBuf[i] ^ tokenBuf[i];
    }
    return diff === 0;
  } catch {
    return false;
  }
}
