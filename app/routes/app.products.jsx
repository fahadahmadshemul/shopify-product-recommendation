import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  BlockStack,
  Banner,
  EmptyState,
  IndexTable,
  Thumbnail,
  Text,
  useIndexResourceState,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import {
  syncProducts,
  getProductsFromDB,
} from "../services/products.server.js";
import { authenticate } from "../shopify.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const products = await getProductsFromDB(session.shop);
  return { products };
};

export const action = async ({ request }) => {
  await syncProducts(request);
  return { success: true };
};

export default function ProductsPage() {
  const { products } = useLoaderData();
  const fetcher = useFetcher();
  const isSyncing = fetcher.state !== "idle";

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
          ${Number(product.price).toFixed(2)}
        </Text>
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
        disabled: isSyncing,
        onAction: () => fetcher.submit({}, { method: "post" }),
      }}
    >
      <BlockStack gap="500">
        {fetcher.data?.success && (
          <Banner title="Products synced successfully!" tone="success" />
        )}

        {products.length === 0 ? (
          <EmptyState
            heading="No products synced yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Click "Sync Products" to import your store products.</p>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={resourceName}
            itemCount={products.length}
            selectedItemsCount={
              allResourcesSelected ? "All" : selectedResources.length
            }
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "Image" },
              { title: "Product Title" },
              { title: "Price", alignment: "end" },
            ]}
          >
            {rowMarkup}
          </IndexTable>
        )}
      </BlockStack>
    </Page>
  );
}
