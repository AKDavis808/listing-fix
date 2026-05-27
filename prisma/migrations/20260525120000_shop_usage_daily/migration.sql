-- CreateTable
CREATE TABLE "ShopUsageDaily" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "aiGenerationCount" INTEGER NOT NULL DEFAULT 0,
    "applyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopUsageDaily_shop_idx" ON "ShopUsageDaily"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopUsageDaily_shop_usageDate_key" ON "ShopUsageDaily"("shop", "usageDate");
