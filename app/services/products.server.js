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
            featuredImage {
              url
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  const products = data.data.products.edges.map((edge) => edge.node);

  for (const product of products) {
    await db.product.upsert({
      where: { id: product.id },
      update: {
        title: product.title,
        handle: product.handle,
        price: parseFloat(product.priceRangeV2.minVariantPrice.amount),
        imageUrl: product.featuredImage ? product.featuredImage.url : null,
        shopDomain: session.shop,
      },
      create: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        price: parseFloat(product.priceRangeV2.minVariantPrice.amount),
        imageUrl: product.featuredImage ? product.featuredImage.url : null,
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
            featuredImage {
              url
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
        continue; // skip if limit exceeded
      }
      savedCount++;
    }

    const price = parseFloat(product.priceRangeV2.minVariantPrice.amount);
    const imageUrl = product.featuredImage ? product.featuredImage.url : null;

    const saved = await db.product.upsert({
      where: { id: product.id },
      update: {
        title: product.title,
        handle: product.handle,
        price,
        imageUrl,
        shopDomain: session.shop,
      },
      create: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        price,
        imageUrl,
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
