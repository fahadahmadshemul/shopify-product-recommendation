# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/


# workflow
- When reviewing a system, explore all related files thoroughly first, then proactively implement the improvements rather than just providing analysis. Confidence: 0.70
- Document all features comprehensively in .commandcode/session-context.md as a complete project reference that can be rewritten from scratch for clarity when needed. Confidence: 0.90
- Save codebase gap analysis findings (bugs, missing features, incomplete implementations) to session-context.md so future sessions can pick up context even if the conversation is lost. Confidence: 0.70

# communication
- Use English or Banglish (Bangla written in Roman script), never Bangla script for output. Confidence: 0.90

# prisma
- On Windows, when Prisma generate fails with EPERM rename error on query_engine-windows.dll.node, rename the locked file first (using `ren`) instead of trying to delete it, then re-run prisma generate. Confidence: 0.65

# shopify
- Strip Shopify Admin API GID prefixes (e.g., `gid://shopify/ProductVariant/123` → `123`) before storing variant IDs, since storefront endpoints like `/cart/add.js` require plain numeric IDs. Confidence: 0.65
- Do NOT add GDPR webhook topics (customers/data_request, customers/redact, shop/redact) to shopify.app.toml — Shopify CLI rejects them as invalid during dev preview. Handle GDPR compliance separately. Confidence: 0.70
- Use session token authentication and the latest version of App Bridge on every embedded admin page to meet Shopify's embedded app highlight criteria. Confidence: 0.70
- Non-approved apps cannot subscribe to webhook topics containing protected customer data (e.g., orders/create). Use alternative approaches like checkout post-purchase extensions or pixel webhooks for purchase tracking until the app is approved for protected data. Confidence: 0.65

# polaris
- Use `roundedAbove="xs"` on Polaris `Card` components to ensure rounded corners on all screen sizes, since the default `roundedAbove="sm"` leaves cards square on mobile (xs). Confidence: 0.70

# data-modeling
- Store price at the time of each purchase event rather than calculating historical revenue from current product prices, since product prices change over time and historical accuracy matters. Confidence: 0.60
- Use 0.0 (zero) as fallback for calculated metrics when no underlying data exists, not an arbitrary hardcoded number like 29.99. Confidence: 0.70

# design
- For Shopify recommendation widgets, follow international e-commerce standards and Shopify's own recommendation design patterns (visible card structure with background, borders, subtle shadows) — do not go overly minimal or purely theme-blending. Confidence: 0.80
- Make widget appearance settings (background, border, border-radius, heading text, colors) dynamically configurable from the app dashboard, stored per-shop in the database. Confidence: 0.70

