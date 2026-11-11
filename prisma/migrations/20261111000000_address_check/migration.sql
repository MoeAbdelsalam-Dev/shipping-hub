-- CreateTable
CREATE TABLE "AddressCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL,
    "confirmedType" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AddressCheck_shop_addressKey_key" ON "AddressCheck"("shop", "addressKey");
