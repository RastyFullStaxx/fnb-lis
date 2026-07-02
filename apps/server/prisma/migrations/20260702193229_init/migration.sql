-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "failedLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Location_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserClientAccess" (
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "clientId"),
    CONSTRAINT "UserClientAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserClientAccess_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "factorToBase" REAL NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "defaultDensityFactor" REAL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItemVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "size" REAL NOT NULL,
    "unitId" TEXT NOT NULL,
    "contentTracked" BOOLEAN NOT NULL DEFAULT false,
    "tareWeight" REAL,
    "tareWeightUnit" TEXT,
    "densityFactor" REAL,
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ItemVariant_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemVariant_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LocationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "itemVariantId" TEXT NOT NULL,
    "cost" REAL NOT NULL DEFAULT 0,
    "retail" REAL NOT NULL DEFAULT 0,
    "parLevel" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LocationItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LocationItem_itemVariantId_fkey" FOREIGN KEY ("itemVariantId") REFERENCES "ItemVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactInfo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Supplier_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItemAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "aliasNormalized" TEXT NOT NULL,
    "locationItemId" TEXT,
    "menuItemId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    CONSTRAINT "ItemAlias_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemAlias_locationItemId_fkey" FOREIGN KEY ("locationItemId") REFERENCES "LocationItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ItemAlias_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CountSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "countDate" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" DATETIME,
    "committedById" TEXT,
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "CountSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CountLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "countSessionId" TEXT NOT NULL,
    "locationItemId" TEXT NOT NULL,
    "countType" TEXT NOT NULL,
    "qtyFull" REAL NOT NULL DEFAULT 0,
    "scaleWeight" REAL,
    "scaleUnit" TEXT,
    "tareWeight" REAL,
    "densityFactor" REAL,
    "remainingContent" REAL NOT NULL DEFAULT 0,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "unitRetail" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    "correctionOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CountLine_countSessionId_fkey" FOREIGN KEY ("countSessionId") REFERENCES "CountSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CountLine_locationItemId_fkey" FOREIGN KEY ("locationItemId") REFERENCES "LocationItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CountLine_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "CountLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "supplierId" TEXT,
    "refNo" TEXT,
    "purchaseDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" DATETIME,
    "committedById" TEXT,
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "Purchase_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseId" TEXT NOT NULL,
    "locationItemId" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "unitCost" REAL NOT NULL,
    "lineTotal" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    "correctionOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseLine_locationItemId_fkey" FOREIGN KEY ("locationItemId") REFERENCES "LocationItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseLine_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "PurchaseLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "saleDate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "locationItemId" TEXT,
    "menuItemId" TEXT,
    "recipeVersionId" TEXT,
    "qty" REAL NOT NULL,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "discountPct" REAL NOT NULL DEFAULT 0,
    "contentOverride" REAL,
    "reason" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    "correctionOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleRecord_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleRecord_locationItemId_fkey" FOREIGN KEY ("locationItemId") REFERENCES "LocationItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleRecord_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleRecord_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "RecipeVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleRecord_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "SaleRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Forfeit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "forfeitDate" TEXT NOT NULL,
    "locationItemId" TEXT NOT NULL,
    "scaleWeight" REAL,
    "scaleUnit" TEXT,
    "tareWeight" REAL,
    "densityFactor" REAL,
    "remainingContent" REAL NOT NULL DEFAULT 0,
    "qty" REAL NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    "correctionOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Forfeit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Forfeit_locationItemId_fkey" FOREIGN KEY ("locationItemId") REFERENCES "LocationItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Forfeit_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "Forfeit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MenuItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecipeVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "menuItemId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "srp" REAL NOT NULL,
    "costAtPublish" REAL NOT NULL DEFAULT 0,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "RecipeVersion_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeVersionId" TEXT NOT NULL,
    "locationItemId" TEXT NOT NULL,
    "servingQty" REAL NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RecipeLine_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "RecipeVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecipeLine_locationItemId_fkey" FOREIGN KEY ("locationItemId") REFERENCES "LocationItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "extractor" TEXT NOT NULL,
    "model" TEXT,
    "rawExtractJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "businessDate" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" DATETIME,
    "committedById" TEXT,
    "reversedAt" DATETIME,
    "reversedById" TEXT,
    CONSTRAINT "ImportBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rawJson" TEXT NOT NULL,
    "itemText" TEXT NOT NULL,
    "qty" REAL,
    "unitCost" REAL,
    "unitPrice" REAL,
    "rowDate" TEXT,
    "matchedLocationItemId" TEXT,
    "matchedMenuItemId" TEXT,
    "matchMethod" TEXT,
    "confidence" REAL,
    "warning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultType" TEXT,
    "resultId" TEXT,
    CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT,
    "clientId" TEXT,
    "locationId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "detailsJson" TEXT
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL DEFAULT '',
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "Location_clientId_idx" ON "Location"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_name_key" ON "Unit"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemVariant_itemId_size_unitId_key" ON "ItemVariant"("itemId", "size", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationItem_locationId_itemVariantId_key" ON "LocationItem"("locationId", "itemVariantId");

-- CreateIndex
CREATE INDEX "Supplier_clientId_idx" ON "Supplier"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemAlias_clientId_aliasNormalized_key" ON "ItemAlias"("clientId", "aliasNormalized");

-- CreateIndex
CREATE INDEX "CountSession_locationId_countDate_idx" ON "CountSession"("locationId", "countDate");

-- CreateIndex
CREATE INDEX "CountLine_countSessionId_idx" ON "CountLine"("countSessionId");

-- CreateIndex
CREATE INDEX "CountLine_locationItemId_idx" ON "CountLine"("locationItemId");

-- CreateIndex
CREATE INDEX "Purchase_locationId_purchaseDate_idx" ON "Purchase"("locationId", "purchaseDate");

-- CreateIndex
CREATE INDEX "PurchaseLine_purchaseId_idx" ON "PurchaseLine"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseLine_locationItemId_idx" ON "PurchaseLine"("locationItemId");

-- CreateIndex
CREATE INDEX "SaleRecord_locationId_saleDate_kind_idx" ON "SaleRecord"("locationId", "saleDate", "kind");

-- CreateIndex
CREATE INDEX "SaleRecord_locationItemId_idx" ON "SaleRecord"("locationItemId");

-- CreateIndex
CREATE INDEX "Forfeit_locationId_forfeitDate_idx" ON "Forfeit"("locationId", "forfeitDate");

-- CreateIndex
CREATE INDEX "MenuItem_locationId_idx" ON "MenuItem"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVersion_menuItemId_versionNo_key" ON "RecipeVersion"("menuItemId", "versionNo");

-- CreateIndex
CREATE INDEX "RecipeLine_recipeVersionId_idx" ON "RecipeLine"("recipeVersionId");

-- CreateIndex
CREATE INDEX "ImportBatch_locationId_idx" ON "ImportBatch"("locationId");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_idx" ON "ImportRow"("batchId");

-- CreateIndex
CREATE INDEX "ActivityLog_ts_idx" ON "ActivityLog"("ts");

-- CreateIndex
CREATE INDEX "ActivityLog_entity_entityId_idx" ON "ActivityLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_clientId_key_key" ON "Setting"("clientId", "key");
