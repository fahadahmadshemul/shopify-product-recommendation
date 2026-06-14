import db from "../db.server.js";
import { authenticate } from "../shopify.server.js";

export async function syncProducts(request) {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      products(first: 50) {
        edges {
          node {
            id
            title
            handle
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
  `);

  const data = await response.json();
  const products = data.data.products.edges.map((edge) => edge.node);

  for (const product of products) {
    const variants = product.variants?.edges || [];
    const firstVariantId = variants.length > 0 ? variants[0].node.id : null;
    const compareAtPrice = product.compareAtPriceRange
      ? parseFloat(product.compareAtPriceRange.minVariantCompareAtPrice.amount) || null
      : null;

    await db.product.upsert({
      where: { id: product.id },
      update: {
        title: product.title,
        handle: product.handle,
        price: parseFloat(product.priceRangeV2.minVariantPrice.amount),
        compareAtPrice,
        imageUrl: product.featuredImage ? product.featuredImage.url : null,
        firstVariantId,
        shopDomain: session.shop,
      },
      create: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        price: parseFloat(product.priceRangeV2.minVariantPrice.amount),
        compareAtPrice,
        imageUrl: product.featuredImage ? product.featuredImage.url : null,
        firstVariantId,
        shopDomain: session.shop,
      }
    })
  }

  return products;
}

export async function syncProductsWithLimit(request, limit, currentCount) {
  const { admin, session } = await authenticate.admin(request);

  // We fetch up to the limit, or 250 if unlimited
  const limitToFetch = limit === null ? 250 : Math.min(250, limit);

  const response = await admin.graphql(`
    query {
      products(first: ${limitToFetch}) {
        edges {
          node {
            id
            title
            handle
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
  `);

  const data = await response.json();
  const products = data.data.products.edges.map((edge) => edge.node);

  let savedProducts = [];
  let savedCount = currentCount;

  for (const product of products) {
    const exists = await db.product.findUnique({
      where: { id: product.id },
    });

    if (!exists) {
      if (limit !== null && savedCount >= limit) {
        continue;
      }
      savedCount++;
    }

    const price = parseFloat(product.priceRangeV2.minVariantPrice.amount);
    const compareAtPrice = product.compareAtPriceRange
      ? parseFloat(product.compareAtPriceRange.minVariantCompareAtPrice.amount) || null
      : null;
    const imageUrl = product.featuredImage ? product.featuredImage.url : null;
    const variants = product.variants?.edges || [];
    const firstVariantId = variants.length > 0 ? variants[0].node.id : null;

    const saved = await db.product.upsert({
      where: { id: product.id },
      update: {
        title: product.title,
        handle: product.handle,
        price,
        compareAtPrice,
        imageUrl,
        firstVariantId,
        shopDomain: session.shop,
      },
      create: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        price,
        compareAtPrice,
        imageUrl,
        firstVariantId,
        shopDomain: session.shop,
      },
    });

    savedProducts.push(saved);
  }

  return savedProducts;
}

export async function getProductsFromDB(shopDomain) {
  return await db.product.findMany({
    where: { shopDomain },
  });
}
