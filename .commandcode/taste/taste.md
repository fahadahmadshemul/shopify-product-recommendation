# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- When reviewing a system, explore all related files thoroughly first, then proactively implement the improvements rather than just providing analysis. Confidence: 0.70
- Document all features comprehensively in .commandcode/session-context.md as a complete project reference that can be rewritten from scratch for clarity when needed. Confidence: 0.90

# communication
- Use English or Banglish (Bangla written in Roman script), never Bangla script for output. Confidence: 0.90

# prisma
- On Windows, when Prisma generate fails with EPERM rename error on query_engine-windows.dll.node, rename the locked file first (using `ren`) instead of trying to delete it, then re-run prisma generate. Confidence: 0.65

# shopify
- Strip Shopify Admin API GID prefixes (e.g., `gid://shopify/ProductVariant/123` → `123`) before storing variant IDs, since storefront endpoints like `/cart/add.js` require plain numeric IDs. Confidence: 0.65
- Do NOT add GDPR webhook topics (customers/data_request, customers/redact, shop/redact) to shopify.app.toml — Shopify CLI rejects them as invalid during dev preview. Handle GDPR compliance separately. Confidence: 0.70
- Use session token authentication and the latest version of App Bridge on every embedded admin page to meet Shopify's embedded app highlight criteria. Confidence: 0.70

