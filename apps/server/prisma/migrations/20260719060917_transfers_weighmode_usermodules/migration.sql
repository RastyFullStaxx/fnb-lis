-- AlterTable
ALTER TABLE "ItemVariant" ADD COLUMN "weighMode" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "kind" TEXT;

-- CreateTable
CREATE TABLE "UserModule" (
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,

    PRIMARY KEY ("userId", "module"),
    CONSTRAINT "UserModule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
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
    CONSTRAINT "Transfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferId" TEXT NOT NULL,
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
    CONSTRAINT "TransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferLine_locationItemId_fkey" FOREIGN KEY ("locationItemId") REFERENCES "LocationItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferLine_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "TransferLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransferReceiptLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferLineId" TEXT NOT NULL,
    "toLocationItemId" TEXT NOT NULL,
    "qtyReceived" REAL NOT NULL,
    "receiptDate" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    "correctionOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransferReceiptLine_transferLineId_fkey" FOREIGN KEY ("transferLineId") REFERENCES "TransferLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferReceiptLine_toLocationItemId_fkey" FOREIGN KEY ("toLocationItemId") REFERENCES "LocationItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferReceiptLine_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "TransferReceiptLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Transfer_fromLocationId_businessDate_idx" ON "Transfer"("fromLocationId", "businessDate");

-- CreateIndex
CREATE INDEX "Transfer_toLocationId_businessDate_idx" ON "Transfer"("toLocationId", "businessDate");

-- CreateIndex
CREATE INDEX "TransferLine_transferId_idx" ON "TransferLine"("transferId");

-- CreateIndex
CREATE INDEX "TransferLine_locationItemId_idx" ON "TransferLine"("locationItemId");

-- CreateIndex
CREATE INDEX "TransferReceiptLine_transferLineId_idx" ON "TransferReceiptLine"("transferLineId");

-- CreateIndex
CREATE INDEX "TransferReceiptLine_toLocationItemId_idx" ON "TransferReceiptLine"("toLocationItemId");

-- CreateIndex
CREATE INDEX "TransferReceiptLine_receiptDate_idx" ON "TransferReceiptLine"("receiptDate");
