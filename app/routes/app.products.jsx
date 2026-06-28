import {
  useLoaderData,
  useFetcher,
  useRouteError,
  Link as RouterLink,
} from "react-router";

import { useState, useEffect } from "react";
import {
  Page,
  BlockStack,
  Banner,
  EmptyState,
  IndexTable,
  Thumbnail,
  Text,
  useIndexResourceState,
  ProgressBar,
  Card,
  Box,
  InlineStack,
  Badge,
  Button,
  Tooltip,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  syncProductsWithLimit,
  getProductsFromDB,
} from "../services/products.server.js";
import { authenticate } from "../shopify.server.js";
import db from "../db.server";
import { extractNumericGid } from "../utils/gid.js";
import { resolveActivePlan } from "../services/billing.service";

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);

  const [products, { plan: activePlan }] = await Promise.all([
    getProductsFromDB(session.shop),
    resolveActivePlan(session.shop, billing),
  ]);

  return {
    products,
    activePlan,
  };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  const [currentCount, { plan: activePlan }] = await Promise.all([
    db.product.count({ where: { shopDomain: session.shop } }),
    resolveActivePlan(session.shop, billing),
  ]);

  const limit = activePlan.limits.products;

  if (actionType === "sync") {
    if (limit !== null && currentCount >= limit) {
      return Response.json({
        success: false,
        error: `Sync limit reached (${limit} products). Please upgrade your plan.`,
      });
    }

    const synced = await syncProductsWithLimit(request, limit, currentCount);
    return Response.json({
      success: true,
      count: synced.length,
      limitExceeded: limit !== null && currentCount + synced.length >= limit,
    });
  }

  if (actionType === "add_products") {
    const productsJson = formData.get("products");
    const selectedProducts = JSON.parse(productsJson);

    let savedCount = currentCount;
    let addedCount = 0;
    let limitExceeded = false;

    for (const product of selectedProducts) {
      const exists = await db.product.findUnique({
        where: { id: product.id },
      });

      if (!exists) {
        if (limit !== null && savedCount >= limit) {
          limitExceeded = true;
          break;
        }
        savedCount++;
      }

      const price = product.variants?.[0]?.price
        ? parseFloat(product.variants[0].price)
        : 0;
      const compareAtPrice = product.variants?.[0]?.compare_at_price
        ? parseFloat(product.variants[0].compare_at_price)
        : null;
      const firstVariantId = extractNumericGid(
        product.variants?.[0]?.id ?? null,
      );
      const imageUrl = product.images?.[0]?.originalSrc || null;

      await db.product.upsert({
        where: { id: product.id },
        update: {
          title: product.title,
          handle: product.handle || null,
          price,
          compareAtPrice,
          firstVariantId,
          imageUrl,
          shopDomain: session.shop,
        },
        create: {
          id: product.id,
          title: product.title,
          handle: product.handle || null,
          price,
          compareAtPrice,
          firstVariantId,
          imageUrl,
          shopDomain: session.shop,
        },
      });
      addedCount++;
    }

    return Response.json({
      success: true,
      added: addedCount,
      limitExceeded,
    });
  }

  if (actionType === "delete_products") {
    const productIdsJson = formData.get("productIds");
    const productIds = JSON.parse(productIdsJson);

    await db.product.deleteMany({
      where: {
        id: { in: productIds },
        shopDomain: session.shop,
      },
    });

    return Response.json({
      success: true,
      deleted: productIds.length,
    });
  }

  if (actionType === "toggle_exclude") {
    const productId = formData.get("productId");
    const excluded = formData.get("excluded") === "true";
    if (!productId) {
      return Response.json({ success: false, error: "Missing productId" });
    }
    await db.product.update({
      where: { id: productId, shopDomain: session.shop },
      data: { excludedFromRecs: excluded },
    });
    return Response.json({ success: true, toggled: productId, excludedFromRecs: excluded });
  }

  return Response.json({ success: false, error: "Invalid action" });
};

export default function ProductsPage() {
  const { products, activePlan } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSyncing = fetcher.state !== "idle";
  const [bannerInfo, setBannerInfo] = useState(null);

  const limit = activePlan.limits.products;
  const isLimitReached = limit !== null && products.length >= limit;

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.success) {
        if (fetcher.data.count !== undefined) {
          setBannerInfo({
            title: `Successfully synced ${fetcher.data.count} products!`,
            tone: "success",
          });
        } else if (fetcher.data.added !== undefined) {
          setBannerInfo({
            title: `Successfully added ${fetcher.data.added} products!`,
            tone: "success",
          });
        } else if (fetcher.data.deleted !== undefined) {
          setBannerInfo({
            title: `Successfully removed ${fetcher.data.deleted} products!`,
            tone: "success",
          });
        }

        if (fetcher.data.limitExceeded) {
          setBannerInfo({
            title:
              "Product limit reached for your current plan. Some products were skipped.",
            tone: "warning",
          });
        }
      } else if (fetcher.data.error) {
        setBannerInfo({
          title: fetcher.data.error,
          tone: "critical",
        });
      }
    }
  }, [fetcher.data]);

  const handleSearchAndAdd = async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
      });

      if (selected && selected.length > 0) {
        fetcher.submit(
          {
            action: "add_products",
            products: JSON.stringify(selected),
          },
          { method: "POST" },
        );
      }
    } catch (err) {
      console.error("Resource picker error:", err);
    }
  };

  const handleSingleDelete = (productId) => {
    fetcher.submit(
      {
        action: "delete_products",
        productIds: JSON.stringify([productId]),
      },
      { method: "POST" },
    );
  };

  const handleToggleExclude = (productId, currentlyExcluded) => {
    fetcher.submit(
      {
        action: "toggle_exclude",
        productId,
        excluded: String(!currentlyExcluded),
      },
      { method: "POST" },
    );
  };

  const handleBulkDelete = () => {
    fetcher.submit(
      {
        action: "delete_products",
        productIds: JSON.stringify(selectedResources),
      },
      { method: "POST" },
    );
  };

  const resourceName = { singular: "product", plural: "products" };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(products);

  const rowMarkup = products.map((product, index) => {
    // Derive status badge tone and label for display
    const statusTone =
      product.status === "ACTIVE" ? "success"
      : product.status === "DRAFT" ? "warning"
      : product.status === "ARCHIVED" ? "critical"
      : null;
    const statusLabel = product.status
      ? product.status.charAt(0) + product.status.slice(1).toLowerCase()
      : null;

    return (
      <IndexTable.Row
        id={product.id}
        key={product.id}
        selected={selectedResources.includes(product.id)}
        position={index}
      >
        <IndexTable.Cell>
          <Thumbnail
            source={product.imageUrl || ImageIcon}
            alt={product.title}
            size="small"
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {product.title}
            </Text>
            {statusLabel && (
              <Badge tone={statusTone}>{statusLabel}</Badge>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" numeric>
            {Number(product.price).toFixed(2)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Tooltip
            content={
              product.excludedFromRecs
                ? "This product is excluded from recommendations. Click to re-include it."
                : "Click to exclude this product from all recommendations (e.g. gift cards, samples)."
            }
          >
            <Button
              id={`exclude-btn-${product.id}`}
              tone={product.excludedFromRecs ? undefined : "critical"}
              variant="plain"
              onClick={() => handleToggleExclude(product.id, product.excludedFromRecs)}
              disabled={isSyncing}
            >
              {product.excludedFromRecs ? "Re-include" : "Exclude"}
            </Button>
          </Tooltip>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Button
            tone="critical"
            variant="plain"
            onClick={() => handleSingleDelete(product.id)}
          >
            Remove
          </Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Products"
      subtitle="Manage and sync your store's recommendation products."
      primaryAction={{
        content: isSyncing ? "Syncing..." : "Sync Products",
        loading: isSyncing,
        disabled: isSyncing || isLimitReached,
        onAction: () => fetcher.submit({ action: "sync" }, { method: "post" }),
      }}
      secondaryActions={[
        {
          content: "Search & Add Products",
          disabled: isSyncing || isLimitReached,
          onAction: handleSearchAndAdd,
        },
      ]}
    >
      <Box paddingInline={{ xs: "400", md: "0" }}>
        <BlockStack gap="500">
          {bannerInfo && (
            <Banner
              title={bannerInfo.title}
              tone={bannerInfo.tone}
              onDismiss={() => setBannerInfo(null)}
            />
          )}

          {/* Plan Limit Status */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Plan Limit Status:{" "}
                    <Badge tone={isLimitReached ? "critical" : "info"}>
                      {activePlan.name} Plan
                    </Badge>
                  </Text>
                  <Text variant="bodyMd" tone="subdued">
                    {limit !== null
                      ? `You have synced ${products.length} out of ${limit} products allowed.`
                      : `You have synced ${products.length} products (Unlimited sync).`}
                  </Text>
                </BlockStack>
                {limit !== null && (
                  <RouterLink to="/app/billing">Upgrade plan</RouterLink>
                )}
              </InlineStack>
              {limit !== null && (
                <ProgressBar
                  progress={Math.min(100, (products.length / limit) * 100)}
                  tone={isLimitReached ? "critical" : "primary"}
                />
              )}
            </BlockStack>
          </Card>

          {products.length === 0 ? (
            <EmptyState
              heading="No products synced yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Click "Sync Products" or "Search & Add Products" to add store
                products.
              </p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={products.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              bulkActions={[
                {
                  content: "Remove from recommendations",
                  onAction: handleBulkDelete,
                },
              ]}
              headings={[
                { title: "Image" },
                { title: "Product Title" },
                { title: "Price", alignment: "end" },
                { title: "Recommendations", alignment: "end" },
                { title: "Actions", alignment: "end" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          )}
        </BlockStack>
      </Box>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
