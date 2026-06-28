import db from "../db.server.js";
import { authenticate } from "../shopify.server.js";
import { extractNumericGid } from "../utils/gid.js";

// Maximum products fetched per GraphQL page. Shopify allows up to 250,
// but 50 keeps each request fast and avoids timeout risk on slow connections.
const PAGE_SIZE = 50;

// Shared GraphQL query fragment — both sync functions use the same shape.
// Uses cursor-based pagination: pageInfo.hasNextPage + endCursor drive the loop.
const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          status
          totalInventory
          hasOnlyDefaultVariant
          priceRangeV2 {
            minVariantPrice {
              amount
            }
          }
          compareAtPriceRange {
            minVariantCompareAtPrice {
              amount
            }
          }
          featuredImage {
            url
          }
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Maps a raw Shopify GraphQL product node to the fields expected by our Prisma upsert.
 */
function mapProductNode(node, shopDomain) {
  const variants = node.variants?.edges || [];
  const firstVariantId = extractNumericGid(variants.length > 0 ? variants[0].node.id : null);
  const compareAtPrice = node.compareAtPriceRange
    ? parseFloat(node.compareAtPriceRange.minVariantCompareAtPrice.amount) || null
    : null;
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    price: parseFloat(node.priceRangeV2.minVariantPrice.amount),
    compareAtPrice,
    imageUrl: node.featuredImage ? node.featuredImage.url : null,
    firstVariantId,
    hasSingleVariant: node.hasOnlyDefaultVariant ?? true,
    shopDomain,
    // Availability — null if Shopify doesn't return the field (backward compat: treated as available)
    status: node.status ?? null,
    totalInventory: node.totalInventory ?? null,
  };
}

/**
 * Upserts a single mapped product record.
 * Returns the saved DB record.
 */
async function upsertProduct(mapped) {
  const { id, shopDomain, ...fields } = mapped;
  return db.product.upsert({
    where: { id },
    // shopDomain is intentionally included in create but not update —
    // a product's owning shop should not change once recorded.
    create: { id, shopDomain, ...fields },
    update: fields,
  });
}

/**
 * syncProducts — fetches and upserts ALL products for the authenticated shop,
 * paginating through every Shopify GraphQL page until exhausted.
 *
 * Previously this only fetched the first 50 products (no cursor loop),
 * silently missing everything beyond page 1.
 *
 * Returns: array of all saved DB records.
 */
export async function syncProducts(request) {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const savedProducts = [];
  let cursor = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage) {
    page++;
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: PAGE_SIZE, after: cursor },
    });

    const data = await response.json();
    const productsPage = data.data?.products;
    if (!productsPage) break;

    const nodes = productsPage.edges.map((e) => e.node);

    for (const node of nodes) {
      const mapped = mapProductNode(node, shopDomain);
      const saved = await upsertProduct(mapped);
      savedProducts.push(saved);
    }

    hasNextPage = productsPage.pageInfo.hasNextPage;
    cursor = productsPage.pageInfo.endCursor;

    console.log(`syncProducts: page ${page}, saved ${nodes.length} products (total so far: ${savedProducts.length})`);
  }

  console.log(`syncProducts: complete — ${savedProducts.length} products synced for ${shopDomain}`);
  return savedProducts;
}

/**
 * syncProductsWithLimit — fetches and upserts products for a plan-limited shop,
 * paginating through Shopify pages and stopping as soon as the plan limit is reached.
 *
 * Previously this fetched at most Math.min(250, limit) in a single non-paginated request,
 * meaning BASIC (limit 1000) or PRO (unlimited) shops were silently capped at 250.
 *
 * @param {Request} request  - The incoming admin-authenticated request.
 * @param {number|null} limit        - Plan product cap (null = unlimited / PRO).
 * @param {number} currentCount      - How many products this shop already has synced.
 *
 * Returns: array of newly saved or updated DB records from this sync run.
 */
export async function syncProductsWithLimit(request, limit, currentCount) {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const savedProducts = [];
  let savedCount = currentCount; // tracks total (existing + newly added) against the plan cap
  let cursor = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage) {
    // Stop paging if we've already reached the plan limit.
    if (limit !== null && savedCount >= limit) {
      console.log(`syncProductsWithLimit: plan limit (${limit}) reached at ${savedCount} products — stopping pagination`);
      break;
    }

    page++;
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: PAGE_SIZE, after: cursor },
    });

    const data = await response.json();
    const productsPage = data.data?.products;
    if (!productsPage) break;

    const nodes = productsPage.edges.map((e) => e.node);

    for (const node of nodes) {
      // If this is a product we don't have yet, check the plan cap before adding.
      const isNew = !(await db.product.findUnique({ where: { id: node.id }, select: { id: true } }));

      if (isNew) {
        if (limit !== null && savedCount >= limit) {
          // Limit hit mid-page — stop processing this page and exit the outer loop.
          hasNextPage = false;
          break;
        }
        savedCount++;
      }

      const mapped = mapProductNode(node, shopDomain);
      const saved = await upsertProduct(mapped);
      savedProducts.push(saved);
    }

    if (hasNextPage) {
      hasNextPage = productsPage.pageInfo.hasNextPage;
      cursor = productsPage.pageInfo.endCursor;
    }

    console.log(`syncProductsWithLimit: page ${page}, saved ${savedProducts.length} products (cap: ${limit ?? "unlimited"})`);
  }

  console.log(`syncProductsWithLimit: complete — ${savedProducts.length} products synced for ${shopDomain}`);
  return savedProducts;
}

export async function getProductsFromDB(shopDomain) {
  return await db.product.findMany({
    where: { shopDomain },
  });
}
