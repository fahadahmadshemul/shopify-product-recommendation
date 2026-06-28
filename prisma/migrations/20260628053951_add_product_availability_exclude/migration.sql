-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "price" REAL NOT NULL,
    "compareAtPrice" REAL,
    "imageUrl" TEXT,
    "firstVariantId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "totalInventory" INTEGER,
    "status" TEXT,
    "excludedFromRecs" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Product" ("compareAtPrice", "createdAt", "firstVariantId", "handle", "id", "imageUrl", "price", "shopDomain", "title") SELECT "compareAtPrice", "createdAt", "firstVariantId", "handle", "id", "imageUrl", "price", "shopDomain", "title" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_shopDomain_idx" ON "Product"("shopDomain");
CREATE INDEX "Product_shopDomain_excludedFromRecs_idx" ON "Product"("shopDomain", "excludedFromRecs");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
