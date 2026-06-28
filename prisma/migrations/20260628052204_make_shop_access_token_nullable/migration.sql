-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shop" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "accessToken" TEXT,
    "scope" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "widgetSettings" TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO "new_Shop" ("accessToken", "currency", "id", "installedAt", "isActive", "scope", "shop", "updatedAt", "widgetSettings") SELECT "accessToken", "currency", "id", "installedAt", "isActive", "scope", "shop", "updatedAt", "widgetSettings" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
CREATE UNIQUE INDEX "Shop_shop_key" ON "Shop"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
