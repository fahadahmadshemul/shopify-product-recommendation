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
        price: parseFloat(product.priceRangeV2.minVariantPrice.amount),
        imageUrl: product.featuredImage ? product.featuredImage.url : null,
        shopDomain: session.shop,
      },
      create: {
        id: product.id,
        title: product.title,
        price: parseFloat(product.priceRangeV2.minVariantPrice.amount),
        imageUrl: product.featuredImage ? product.featuredImage.url : null,
        shopDomain: session.shop,
      }
    })
  }

  return products;
}

export async function getProductsFromDB(shopDomain) {
  return await db.product.findMany({
    where: { shopDomain },
  })
}
