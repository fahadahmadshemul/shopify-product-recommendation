-- AlterTable
ALTER TABLE "VisitorActivity" ADD COLUMN "customerId" TEXT;

-- CreateIndex
CREATE INDEX "VisitorActivity_shopDomain_customerId_idx" ON "VisitorActivity"("shopDomain", "customerId");
