-- AlterTable
ALTER TABLE "VisitorActivity" ADD COLUMN "orderId" TEXT;

-- CreateIndex
CREATE INDEX "VisitorActivity_shopDomain_orderId_idx" ON "VisitorActivity"("shopDomain", "orderId");
