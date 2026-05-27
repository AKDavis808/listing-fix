-- CreateTable
CREATE TABLE "CatalogScanSession" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "scanStartedAt" TIMESTAMP(3) NOT NULL,
    "scanCompletedAt" TIMESTAMP(3),
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "averageScore" INTEGER,
    "scanSummary" TEXT,
    "scanResultsJson" JSONB NOT NULL,
    "catalogFingerprint" TEXT,
    "dashboardFilterJson" JSONB,
    "scanDurationMs" INTEGER,
    "topIssue" TEXT,
    "improvementCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogScanSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogScanSession_shopDomain_scanCompletedAt_idx" ON "CatalogScanSession"("shopDomain", "scanCompletedAt");
