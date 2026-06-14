-- CreateIndex
CREATE INDEX "Product_shopDomain_idx" ON "Product"("shopDomain");

-- CreateIndex
CREATE INDEX "Recommendation_shopDomain_createdAt_idx" ON "Recommendation"("shopDomain", "createdAt");

-- CreateIndex
CREATE INDEX "VisitorActivity_shopDomain_productId_idx" ON "VisitorActivity"("shopDomain", "productId");

-- CreateIndex
CREATE INDEX "VisitorActivity_shopDomain_visitorId_idx" ON "VisitorActivity"("shopDomain", "visitorId");
