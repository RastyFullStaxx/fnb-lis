-- AlterTable
ALTER TABLE "ItemVariant" ADD COLUMN "brand" TEXT;
ALTER TABLE "ItemVariant" ADD COLUMN "model" TEXT;

-- AlterTable
ALTER TABLE "LocationItem" ADD COLUMN "assetCode" TEXT;
ALTER TABLE "LocationItem" ADD COLUMN "initialCost" REAL;
ALTER TABLE "LocationItem" ADD COLUMN "serialNo" TEXT;
ALTER TABLE "LocationItem" ADD COLUMN "condition" TEXT;
ALTER TABLE "LocationItem" ADD COLUMN "status" TEXT;
ALTER TABLE "LocationItem" ADD COLUMN "remarks" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LocationItem_assetCode_key" ON "LocationItem"("assetCode");
