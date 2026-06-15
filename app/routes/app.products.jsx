import { useLoaderData, useFetcher, useRouteError } from "react-router";
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
  Link,
  Badge,
  Button
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
import {
  BILLING_PLAN_KEYS,
  BILLING_PLANS,
  PAID_PLAN_KEYS,
  getPlanByName,
} from "../services/billing.service";

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);

  const [products, billingResult] = await Promise.all([
    getProductsFromDB(session.shop),
    billing.check({
      plans: PAID_PLAN_KEYS,
      isTest: globalThis.process?.env?.SHOPIFY_BILLING_TEST !== "false",
    }),
  ]);

  const activeSubscription = billingResult.appSubscriptions.find(
    (subscription) => subscription.status === "ACTIVE",
  );
  const activePaidPlan = activeSubscription
    ? getPlanByName(activeSubscription.name)
    : null;
  const activePlanKey = activePaidPlan?.key ?? BILLING_PLAN_KEYS.FREE;
  const activePlan = BILLING_PLANS[activePlanKey];

  return {
    products,
    activePlan,
  };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  const [currentCount, billingResult] = await Promise.all([
    db.product.count({ where: { shopDomain: session.shop } }),
    billing.check({
      plans: PAID_PLAN_KEYS,
      isTest: globalThis.process?.env?.SHOPIFY_BILLING_TEST !== "false",
    }),
  ]);

  const activeSubscription = billingResult.appSubscriptions.find(
    (subscription) => subscription.status === "ACTIVE",
  );
  const activePaidPlan = activeSubscription
    ? getPlanByName(activeSubscription.name)
    : null;
  const activePlanKey = activePaidPlan?.key ?? BILLING_PLAN_KEYS.FREE;
  const activePlan = BILLING_PLANS[activePlanKey];
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
      limitExceeded: limit !== null && (currentCount + synced.length >= limit),
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
      const firstVariantId = extractNumericGid(product.variants?.[0]?.id ?? null);
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
            title: "Product limit reached for your current plan. Some products were skipped.",
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
          { method: "POST" }
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
      { method: "POST" }
    );
  };

  const handleBulkDelete = () => {
    fetcher.submit(
      {
        action: "delete_products",
        productIds: JSON.stringify(selectedResources),
      },
      { method: "POST" }
    );
  };

  const resourceName = { singular: "product", plural: "products" };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(products);

  const rowMarkup = products.map((product, index) => (
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
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {product.title}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric>
          {Number(product.price).toFixed(2)}
        </Text>
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
  ));

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
                <Link url="/app/billing" removeUnderline>
                  Upgrade Plan
                </Link>
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
            <p>Click "Sync Products" or "Search & Add Products" to add store products.</p>
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
              { title: "Actions", alignment: "end" },
            ]}
          >
            {rowMarkup}
          </IndexTable>
        )}
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
