import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Card, Text, BlockStack, Box, InlineGrid, Layout, InlineStack, Badge, Thumbnail, Divider, ProgressBar } from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const totalViews = await db.visitorActivity.count({
    where: {
      shopDomain: session.shop,
      eventType: "view",
    },
  });

  //total add to cart (support both "cart" and "add_to_cart")
  const totalAddToCart = await db.visitorActivity.count({
    where: {
      shopDomain: session.shop,
      eventType: { in: ["cart", "add_to_cart"] }
    }
  });

  //Purchase Events
  const totalPurchases = await db.visitorActivity.count({
    where: {
      shopDomain: session.shop,
      eventType: "purchase"
    }
  });

  //⚡ Conversion Rate (Views → Purchase)
  const conversionRate = Math.round(
    totalPurchases > 0 ? (totalPurchases / totalViews) * 100 : 0
  );

  //📈 Recommendation Impact Score
  // Percentage of purchases that had matching recommendation entries for the buyer and product
  const purchases = await db.visitorActivity.findMany({
    where: {
      shopDomain: session.shop,
      eventType: "purchase",
    },
    select: {
      visitorId: true,
      productId: true,
    },
  });

  let recommendationImpactScore = 0;
  if (purchases.length > 0) {
    const visitorIds = [...new Set(purchases.map((p) => p.visitorId))];
    const productIds = [...new Set(purchases.map((p) => p.productId))];

    const recommendations = await db.recommendation.findMany({
      where: {
        shopDomain: session.shop,
        visitorId: { in: visitorIds },
        productId: { in: productIds },
      },
      select: {
        visitorId: true,
        productId: true,
      },
    });

    const recSet = new Set(
      recommendations.map((r) => `${r.visitorId}_${r.productId}`)
    );

    let recommendedPurchases = 0;
    for (const purchase of purchases) {
      if (recSet.has(`${purchase.visitorId}_${purchase.productId}`)) {
        recommendedPurchases++;
      }
    }

    recommendationImpactScore = Math.round(
      (recommendedPurchases / purchases.length) * 100
    );
  }

  // 2. 📈 Recommendation Performance Analytics
  // Fetch all recommendations
  const allRecs = await db.recommendation.findMany({
    where: { shopDomain: session.shop },
    select: { visitorId: true, productId: true },
  });
  const totalRecsGenerated = allRecs.length;

  const recVisitorIds = [...new Set(allRecs.map((r) => r.visitorId))];
  const recProductIds = [...new Set(allRecs.map((r) => r.productId))];

  // Fetch view activities for matching recommendations
  const recViews = await db.visitorActivity.findMany({
    where: {
      shopDomain: session.shop,
      eventType: "view",
      visitorId: { in: recVisitorIds },
      productId: { in: recProductIds },
    },
    select: { visitorId: true, productId: true },
  });

  // Fetch purchase activities for matching recommendations
  const recPurchasesFromDB = await db.visitorActivity.findMany({
    where: {
      shopDomain: session.shop,
      eventType: "purchase",
      visitorId: { in: recVisitorIds },
      productId: { in: recProductIds },
    },
    select: { visitorId: true, productId: true },
  });

  const recLookupSet = new Set(
    allRecs.map((r) => `${r.visitorId}_${r.productId}`)
  );

  // Calculate CTR
  const clickedRecs = new Set();
  for (const view of recViews) {
    const key = `${view.visitorId}_${view.productId}`;
    if (recLookupSet.has(key)) {
      clickedRecs.add(key);
    }
  }
  const recCTR = totalRecsGenerated > 0 
    ? Math.round((clickedRecs.size / totalRecsGenerated) * 100)
    : 0;

  // Calculate Conversion Rate
  const purchasedRecs = new Set();
  for (const p of recPurchasesFromDB) {
    const key = `${p.visitorId}_${p.productId}`;
    if (recLookupSet.has(key)) {
      purchasedRecs.add(key);
    }
  }
  const totalRecPurchases = purchasedRecs.size;
  const recConversionRate = clickedRecs.size > 0
    ? Math.round((totalRecPurchases / clickedRecs.size) * 100)
    : 0;

  // Calculate Top 5 best performing recommended products
  const productStatsMap = new Map();
  for (const rec of allRecs) {
    if (!productStatsMap.has(rec.productId)) {
      productStatsMap.set(rec.productId, {
        productId: rec.productId,
        impressions: 0,
        clicks: 0,
        purchases: 0,
      });
    }
    productStatsMap.get(rec.productId).impressions++;
  }

  // Count unique visitor clicks
  const uniqueClicks = new Set();
  for (const view of recViews) {
    const key = `${view.visitorId}_${view.productId}`;
    if (recLookupSet.has(key) && !uniqueClicks.has(key)) {
      uniqueClicks.add(key);
      const stat = productStatsMap.get(view.productId);
      if (stat) {
        stat.clicks++;
      }
    }
  }

  // Count unique visitor purchases
  const uniquePurchases = new Set();
  for (const p of recPurchasesFromDB) {
    const key = `${p.visitorId}_${p.productId}`;
    if (recLookupSet.has(key) && !uniquePurchases.has(key)) {
      uniquePurchases.add(key);
      const stat = productStatsMap.get(p.productId);
      if (stat) {
        stat.purchases++;
      }
    }
  }

  // Fetch product titles and image URLs
  const dbProducts = await db.product.findMany({
    where: { shopDomain: session.shop },
    select: { id: true, title: true, imageUrl: true },
  });
  const productTitleMap = new Map(dbProducts.map((p) => [p.id, p.title]));
  const productImageMap = new Map(dbProducts.map((p) => [p.id, p.imageUrl]));

  const topProducts = Array.from(productStatsMap.values())
    .map((stat) => ({
      ...stat,
      title: productTitleMap.get(stat.productId) || stat.productId.replace("gid://shopify/Product/", ""),
      imageUrl: productImageMap.get(stat.productId) || null,
    }))
    .sort((a, b) => b.purchases - a.purchases || b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 5);

  // 3. Daily Activity Trend for Chart (Last 7 Days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const dailyActivities = await db.visitorActivity.findMany({
    where: {
      shopDomain: session.shop,
      createdAt: { gte: sevenDaysAgo },
    },
    select: {
      eventType: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const dailyDataMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("en-US", { weekday: "short" });
    dailyDataMap[dateStr] = { label, views: 0, purchases: 0 };
  }

  for (const act of dailyActivities) {
    const dateStr = act.createdAt.toISOString().split("T")[0];
    if (dailyDataMap[dateStr]) {
      if (act.eventType === "view") {
        dailyDataMap[dateStr].views++;
      } else if (act.eventType === "purchase") {
        dailyDataMap[dateStr].purchases++;
      }
    }
  }

  const chartData = Object.values(dailyDataMap);

  return {
    totalViews,
    totalAddToCart,
    totalPurchases,
    conversionRate,
    recommendationImpactScore,
    totalRecsGenerated,
    recCTR,
    recConversionRate,
    topProducts,
    chartData,
  };
};

export default function Index() {
  const {
    totalViews,
    totalAddToCart,
    totalPurchases,
    conversionRate,
    recommendationImpactScore,
    totalRecsGenerated,
    recCTR,
    recConversionRate,
    topProducts,
    chartData,
  } = useLoaderData();

  // Helper functions for SVG chart plotting
  const maxVal = Math.max(...chartData.map((d) => Math.max(d.views, d.purchases)), 5);
  const chartHeight = 130;
  const chartWidth = 460;
  const paddingLeft = 30;
  const paddingTop = 15;

  const getX = (index) => paddingLeft + (index * (chartWidth - paddingLeft - 15)) / 6;
  const getY = (val) => chartHeight + paddingTop - (val / maxVal) * chartHeight;

  const getViewsAreaPath = () => {
    if (chartData.length === 0) return "";
    let path = `M ${getX(0)} ${chartHeight + paddingTop}`;
    chartData.forEach((day, idx) => {
      path += ` L ${getX(idx)} ${getY(day.views)}`;
    });
    path += ` L ${getX(chartData.length - 1)} ${chartHeight + paddingTop} Z`;
    return path;
  };

  const getPurchasesAreaPath = () => {
    if (chartData.length === 0) return "";
    let path = `M ${getX(0)} ${chartHeight + paddingTop}`;
    chartData.forEach((day, idx) => {
      path += ` L ${getX(idx)} ${getY(day.purchases)}`;
    });
    path += ` L ${getX(chartData.length - 1)} ${chartHeight + paddingTop} Z`;
    return path;
  };

  const getViewsLinePath = () => {
    if (chartData.length === 0) return "";
    return chartData
      .map((day, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx)} ${getY(day.views)}`)
      .join(" ");
  };

  const getPurchasesLinePath = () => {
    if (chartData.length === 0) return "";
    return chartData
      .map((day, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx)} ${getY(day.purchases)}`)
      .join(" ");
  };

  return (
    <s-page heading="Product Recommendation">
      <BlockStack gap="600">
        {/* Core Store Metrics Grid */}
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd" fontWeight="bold">
            Store Performance Overview
          </Text>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 3, xl: 3 }} gap="400">
            {/* Total Product Views */}
            <Box paddingBlockEnd="200">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm" tone="subdued">
                    Total Product Views
                  </Text>
                  <Text as="p" variant="heading3xl" fontWeight="bold">
                    {totalViews}
                  </Text>
                </BlockStack>
              </Card>
            </Box>

            {/* Total Add To Cart */}
            <Box paddingBlockEnd="200">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm" tone="subdued">
                    Total Add To Cart
                  </Text>
                  <Text as="p" variant="heading3xl" fontWeight="bold">
                    {totalAddToCart}
                  </Text>
                </BlockStack>
              </Card>
            </Box>

            {/* Total Purchased */}
            <Box paddingBlockEnd="200">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm" tone="subdued">
                    Total Purchased
                  </Text>
                  <Text as="p" variant="heading3xl" fontWeight="bold">
                    {totalPurchases}
                  </Text>
                </BlockStack>
              </Card>
            </Box>

            {/* Conversion Rate */}
            <Box paddingBlockEnd="200">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm" tone="subdued">
                    Conversion Rate
                  </Text>
                  <Text as="p" variant="heading3xl" fontWeight="bold">
                    {conversionRate}%
                  </Text>
                </BlockStack>
              </Card>
            </Box>

            {/* Recommendation Impact Score */}
            <Box paddingBlockEnd="200">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm" tone="subdued">
                    Recommendation Impact Score
                  </Text>
                  <Text as="p" variant="heading3xl" fontWeight="bold">
                    {recommendationImpactScore}%
                  </Text>
                </BlockStack>
              </Card>
            </Box>
          </InlineGrid>
        </BlockStack>

        <Divider />

        {/* Dashboard Layout: Main Section (Left) and Sidebar Section (Right) */}
        <Layout>
          {/* Main Column */}
          <Layout.Section>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingLg" fontWeight="bold">
                  Are recommendations working?
                </Text>
                <Text as="p" tone="subdued">
                  Track the performance of generated recommendations and build trust in the recommendation algorithm.
                </Text>
              </BlockStack>

              <InlineGrid columns={{ xs: 1, sm: 3, md: 3, lg: 3, xl: 3 }} gap="400">
                <Card>
                  <BlockStack gap="150">
                    <Text as="h3" variant="headingSm" tone="subdued">
                      Recommendations Generated
                    </Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {totalRecsGenerated}
                    </Text>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="150">
                    <Text as="h3" variant="headingSm" tone="subdued">
                      Click-through Rate (CTR)
                    </Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {recCTR}%
                    </Text>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="150">
                    <Text as="h3" variant="headingSm" tone="subdued">
                      Recommendation Conversion
                    </Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {recConversionRate}%
                    </Text>
                  </BlockStack>
                </Card>
              </InlineGrid>

              {/* Top Performing Recommended Products */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd" fontWeight="bold">
                    Top 5 Best Performing Recommended Products
                  </Text>
                  
                  {topProducts.length === 0 ? (
                    <Text as="p" tone="subdued">
                      No recommendation performance data recorded yet.
                    </Text>
                  ) : (
                    <BlockStack gap="300">
                      {topProducts.map((product, index) => (
                        <BlockStack gap="300" key={product.productId}>
                          {index > 0 && <Divider />}
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="300" blockAlign="center">
                              {product.imageUrl ? (
                                <Thumbnail
                                  source={product.imageUrl}
                                  alt={product.title}
                                  size="small"
                                />
                              ) : (
                                <Box
                                  background="bg-surface-neutral-active"
                                  borderRadius="200"
                                  width="40px"
                                  height="40px"
                                />
                              )}
                              <BlockStack gap="100">
                                <Text fontWeight="bold" variant="bodyMd">
                                  {product.title}
                                </Text>
                                <Text tone="subdued" variant="bodySm">
                                  {product.impressions} impressions • {product.clicks} clicks • {product.purchases} purchases
                                </Text>
                              </BlockStack>
                            </InlineStack>
                            <InlineStack gap="200">
                              <Badge tone="info">
                                {product.impressions > 0 
                                  ? Math.round((product.clicks / product.impressions) * 100)
                                  : 0}% CTR
                              </Badge>
                              <Badge tone="success">
                                {product.purchases} sales
                              </Badge>
                            </InlineStack>
                          </InlineStack>
                        </BlockStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* Sidebar Column */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Purchase Conversion Funnel */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd" fontWeight="bold">
                    Conversion Funnel
                  </Text>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text fontWeight="bold">1. Product Views</Text>
                        <Text fontWeight="bold">{totalViews} (100%)</Text>
                      </InlineStack>
                      <ProgressBar progress={100} tone="primary" size="large" />
                    </BlockStack>

                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text fontWeight="bold">2. Add To Cart</Text>
                        <Text tone="subdued">
                          {totalAddToCart} ({totalViews > 0 ? Math.round((totalAddToCart / totalViews) * 100) : 0}%)
                        </Text>
                      </InlineStack>
                      <ProgressBar 
                        progress={totalViews > 0 ? Math.round((totalAddToCart / totalViews) * 100) : 0} 
                        tone="attention" 
                        size="large" 
                      />
                    </BlockStack>

                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text fontWeight="bold">3. Purchases</Text>
                        <Text tone="subdued">
                          {totalPurchases} ({totalViews > 0 ? Math.round((totalPurchases / totalViews) * 100) : 0}%)
                        </Text>
                      </InlineStack>
                      <ProgressBar 
                        progress={totalViews > 0 ? Math.round((totalPurchases / totalViews) * 100) : 0} 
                        tone="success" 
                        size="large" 
                      />
                    </BlockStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Weekly Performance Trend Chart */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd" fontWeight="bold">
                    Weekly Trend (Last 7 Days)
                  </Text>
                  <div style={{ position: "relative", width: "100%", height: "180px" }}>
                    <svg viewBox="0 0 460 180" style={{ width: "100%", height: "100%" }}>
                      {/* Grid Lines */}
                      {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                        const y = getY(maxVal * ratio);
                        return (
                          <g key={idx}>
                            <line
                              x1={paddingLeft}
                              y1={y}
                              x2={chartWidth - 15}
                              y2={y}
                              stroke="#E1E3E5"
                              strokeWidth="1"
                              strokeDasharray="4 4"
                            />
                            <text
                              x={paddingLeft - 6}
                              y={y + 3}
                              textAnchor="end"
                              fontSize="9"
                              fill="#8C9196"
                            >
                              {Math.round(maxVal * ratio)}
                            </text>
                          </g>
                        );
                      })}

                      {/* X Labels */}
                      {chartData.map((day, idx) => (
                        <text
                          key={idx}
                          x={getX(idx)}
                          y={chartHeight + paddingTop + 18}
                          textAnchor="middle"
                          fontSize="9"
                          fill="#8C9196"
                        >
                          {day.label}
                        </text>
                      ))}

                      {/* Views Area & Line */}
                      <path d={getViewsAreaPath()} fill="rgba(0, 128, 255, 0.08)" />
                      <path d={getViewsLinePath()} fill="none" stroke="#0080FF" strokeWidth="2.5" />

                      {/* Purchases Area & Line */}
                      <path d={getPurchasesAreaPath()} fill="rgba(46, 204, 113, 0.08)" />
                      <path d={getPurchasesLinePath()} fill="none" stroke="#2ECC71" strokeWidth="2.5" />

                      {/* Data dots */}
                      {chartData.map((day, idx) => (
                        <g key={idx}>
                          <circle
                            cx={getX(idx)}
                            cy={getY(day.views)}
                            r="3.5"
                            fill="#FFFFFF"
                            stroke="#0080FF"
                            strokeWidth="1.5"
                          />
                          <circle
                            cx={getX(idx)}
                            cy={getY(day.purchases)}
                            r="3.5"
                            fill="#FFFFFF"
                            stroke="#2ECC71"
                            strokeWidth="1.5"
                          />
                        </g>
                      ))}
                    </svg>
                  </div>

                  <InlineStack align="center" gap="400">
                    <InlineStack gap="150" blockAlign="center">
                      <span style={{ display: "inline-block", width: "10px", height: "10px", backgroundColor: "#0080FF", borderRadius: "2px" }} />
                      <Text variant="bodySm" tone="subdued">Views</Text>
                    </InlineStack>
                    <InlineStack gap="150" blockAlign="center">
                      <span style={{ display: "inline-block", width: "10px", height: "10px", backgroundColor: "#2ECC71", borderRadius: "2px" }} />
                      <Text variant="bodySm" tone="subdued">Purchases</Text>
                    </InlineStack>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
