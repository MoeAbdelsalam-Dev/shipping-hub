-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerId" TEXT,
    "carrierId" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "trackingNumbersJson" TEXT NOT NULL DEFAULT '[]',
    "bookedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Shipment_shop_orderId_idx" ON "Shipment"("shop", "orderId");

-- CreateIndex
CREATE INDEX "Shipment_shop_customerId_idx" ON "Shipment"("shop", "customerId");
