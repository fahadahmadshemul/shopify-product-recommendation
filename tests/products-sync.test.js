import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncProducts, syncProductsWithLimit } from "../app/services/products.server.js";
import { authenticate } from "../app/shopify.server.js";
import db from "../app/db.server.js";

// Mock the Prisma DB client
vi.mock("../app/db.server.js", () => {
  return {
    default: {
      product: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    },
  };
});

// Mock Shopify authenticate helper
vi.mock("../app/shopify.server.js", () => {
  return {
    authenticate: {
      admin: vi.fn(),
    },
  };
});

describe("Products Synchronization Pagination", () => {
  const shopDomain = "test-shop.myshopify.com";
  let mockAdmin;

  beforeEach(() => {
    vi.resetAllMocks();

    mockAdmin = {
      graphql: vi.fn(),
    };

    authenticate.admin.mockResolvedValue({
      admin: mockAdmin,
      session: { shop: shopDomain },
    });

    // Default db.product.upsert to return the input data
    db.product.upsert.mockImplementation(({ create }) => Promise.resolve(create));
  });

  describe("syncProducts (Unlimited Sync)", () => {
    it("paginates through multiple pages using GraphQL endCursor", async () => {
      // Mock page 1 response
      const page1Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
              edges: [
                {
                  node: {
                    id: "gid://shopify/Product/1",
                    title: "Product 1",
                    handle: "prod-1",
                    status: "ACTIVE",
                    totalInventory: 10,
                    priceRangeV2: { minVariantPrice: { amount: "10.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/11" } }] },
                  },
                },
              ],
            },
          },
        }),
      };

      // Mock page 2 response
      const page2Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "gid://shopify/Product/2",
                    title: "Product 2",
                    handle: "prod-2",
                    status: "DRAFT",
                    totalInventory: 0,
                    priceRangeV2: { minVariantPrice: { amount: "20.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/22" } }] },
                  },
                },
              ],
            },
          },
        }),
      };

      mockAdmin.graphql
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response);

      const result = await syncProducts(null);

      // Verify that graphql was called twice
      expect(mockAdmin.graphql).toHaveBeenCalledTimes(2);

      // Verify page 1 arguments
      expect(mockAdmin.graphql).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({ variables: { first: 50, after: null } })
      );

      // Verify page 2 arguments used page 1's endCursor
      expect(mockAdmin.graphql).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ variables: { first: 50, after: "cursor-1" } })
      );

      // Verify overall result contains both synced products
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("gid://shopify/Product/1");
      expect(result[1].id).toBe("gid://shopify/Product/2");
    });
  });

  describe("syncProductsWithLimit (Plan Cap Sync)", () => {
    it("stops pagination mid-page as soon as the plan limit is reached", async () => {
      // Plan limit is 2. We start with 1 product already synced. So we can only sync 1 new product.
      const limit = 2;
      const currentCount = 1;

      // Page 1 returns 3 new products. The sync should stop after the first new product is added.
      const page1Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
              edges: [
                {
                  node: {
                    id: "gid://shopify/Product/1",
                    title: "Product 1",
                    handle: "prod-1",
                    status: "ACTIVE",
                    totalInventory: 5,
                    priceRangeV2: { minVariantPrice: { amount: "10.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/11" } }] },
                  },
                },
                {
                  node: {
                    id: "gid://shopify/Product/2",
                    title: "Product 2",
                    handle: "prod-2",
                    status: "ACTIVE",
                    totalInventory: 3,
                    priceRangeV2: { minVariantPrice: { amount: "20.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/22" } }] },
                  },
                },
              ],
            },
          },
        }),
      };

      mockAdmin.graphql.mockResolvedValue(page1Response);

      // Simulate that Product 1 is new, and Product 2 is also new
      db.product.findUnique.mockResolvedValue(null);

      const result = await syncProductsWithLimit(null, limit, currentCount);

      // Verify that we only synced 1 product before stopping (since currentCount (1) + result (1) === limit (2))
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("gid://shopify/Product/1");

      // Verify database upsert was only triggered for the first product
      expect(db.product.upsert).toHaveBeenCalledTimes(1);
      expect(db.product.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "gid://shopify/Product/1" } })
      );
    });

    it("does not increment count or block when upserting an already synced/existing product", async () => {
      // Limit is 2, currentCount is 1.
      const limit = 2;
      const currentCount = 1;

      const page1Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  // This product already exists in DB
                  node: {
                    id: "gid://shopify/Product/existing",
                    title: "Existing Product",
                    handle: "prod-existing",
                    status: "ACTIVE",
                    totalInventory: 20,
                    priceRangeV2: { minVariantPrice: { amount: "15.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/11" } }] },
                  },
                },
                {
                  // This is a new product
                  node: {
                    id: "gid://shopify/Product/new",
                    title: "New Product",
                    handle: "prod-new",
                    status: null,
                    totalInventory: null,
                    priceRangeV2: { minVariantPrice: { amount: "30.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/22" } }] },
                  },
                },
              ],
            },
          },
        }),
      };

      mockAdmin.graphql.mockResolvedValue(page1Response);

      // Product 1 exists in DB, Product 2 does not.
      db.product.findUnique.mockImplementation(({ where }) => {
        if (where.id === "gid://shopify/Product/existing") {
          return Promise.resolve({ id: "gid://shopify/Product/existing" });
        }
        return Promise.resolve(null);
      });

      const result = await syncProductsWithLimit(null, limit, currentCount);

      // Verify both products were processed (since the first one was existing and didn't count against new limit slot)
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("gid://shopify/Product/existing");
      expect(result[1].id).toBe("gid://shopify/Product/new");
    });
  });

  describe("mapProductNode — hasSingleVariant field", () => {
    it("persists hasSingleVariant=true when Shopify reports only a default variant", async () => {
      const page1Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "gid://shopify/Product/77",
                    title: "Single Variant Product",
                    handle: "single-variant",
                    status: "ACTIVE",
                    totalInventory: 5,
                    hasOnlyDefaultVariant: true,
                    priceRangeV2: { minVariantPrice: { amount: "7.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/77" } }] },
                  },
                },
              ],
            },
          },
        }),
      };
      mockAdmin.graphql.mockResolvedValue(page1Response);

      let capturedCreate;
      db.product.upsert.mockImplementation(({ create }) => {
        capturedCreate = create;
        return Promise.resolve(create);
      });

      await syncProducts(null);

      expect(capturedCreate.hasSingleVariant).toBe(true);
      expect(capturedCreate.firstVariantId).toBe("77");
    });

    it("persists hasSingleVariant=false when Shopify reports multiple variants", async () => {
      const page1Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "gid://shopify/Product/66",
                    title: "Multi Variant Product",
                    handle: "multi-variant",
                    status: "ACTIVE",
                    totalInventory: 12,
                    hasOnlyDefaultVariant: false,
                    priceRangeV2: { minVariantPrice: { amount: "12.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/66" } }] },
                  },
                },
              ],
            },
          },
        }),
      };
      mockAdmin.graphql.mockResolvedValue(page1Response);

      let capturedCreate;
      db.product.upsert.mockImplementation(({ create }) => {
        capturedCreate = create;
        return Promise.resolve(create);
      });

      await syncProducts(null);

      expect(capturedCreate.hasSingleVariant).toBe(false);
    });

    it("defaults hasSingleVariant to true when Shopify omits the field (backward compat)", async () => {
      const page1Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "gid://shopify/Product/55",
                    title: "Legacy Product",
                    handle: "legacy",
                    status: "ACTIVE",
                    totalInventory: 8,
                    priceRangeV2: { minVariantPrice: { amount: "3.00" } },
                    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/55" } }] },
                  },
                },
              ],
            },
          },
        }),
      };
      mockAdmin.graphql.mockResolvedValue(page1Response);

      let capturedCreate;
      db.product.upsert.mockImplementation(({ create }) => {
        capturedCreate = create;
        return Promise.resolve(create);
      });

      await syncProducts(null);

      expect(capturedCreate.hasSingleVariant).toBe(true);
    });
  });

  describe("mapProductNode — new availability fields", () => {
    it("persists status and totalInventory when Shopify provides them", async () => {
      const page1Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "gid://shopify/Product/99",
                    title: "Active Product",
                    handle: "active-product",
                    status: "ACTIVE",
                    totalInventory: 42,
                    priceRangeV2: { minVariantPrice: { amount: "9.99" } },
                    variants: { edges: [] },
                  },
                },
              ],
            },
          },
        }),
      };
      mockAdmin.graphql.mockResolvedValue(page1Response);

      // Capture upsert call arguments
      let capturedCreate;
      db.product.upsert.mockImplementation(({ create }) => {
        capturedCreate = create;
        return Promise.resolve(create);
      });

      await syncProducts(null);

      expect(capturedCreate.status).toBe("ACTIVE");
      expect(capturedCreate.totalInventory).toBe(42);
    });

    it("stores null for status and totalInventory when Shopify omits them (backward compat)", async () => {
      const page1Response = {
        json: () => Promise.resolve({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "gid://shopify/Product/88",
                    title: "Legacy Product",
                    handle: "legacy",
                    status: undefined, // not returned by old API
                    totalInventory: undefined,
                    priceRangeV2: { minVariantPrice: { amount: "5.00" } },
                    variants: { edges: [] },
                  },
                },
              ],
            },
          },
        }),
      };
      mockAdmin.graphql.mockResolvedValue(page1Response);

      let capturedCreate;
      db.product.upsert.mockImplementation(({ create }) => {
        capturedCreate = create;
        return Promise.resolve(create);
      });

      await syncProducts(null);

      // null means "not yet synced" — treated as available (backward compat)
      expect(capturedCreate.status).toBeNull();
      expect(capturedCreate.totalInventory).toBeNull();
    });
  });
});
