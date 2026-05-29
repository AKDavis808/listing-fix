-- CreateTable
CREATE TABLE "ProductFieldApplyLog" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fieldsApplied" JSONB NOT NULL,
    "previousValues" JSONB,
    "newValues" JSONB,
    "source" TEXT NOT NULL DEFAULT 'ai_suggestion_review',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFieldApplyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductFieldApplyLog_shopDomain_productId_createdAt_idx" ON "ProductFieldApplyLog"("shopDomain", "productId", "createdAt");
