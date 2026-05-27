-- CreateTable
CREATE TABLE "BetaFeedback" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "feedbackType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "optionalEmail" TEXT,
    "appVersion" TEXT,
    "currentRoute" TEXT,
    "browserInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BetaFeedback_shopDomain_idx" ON "BetaFeedback"("shopDomain");

-- CreateIndex
CREATE INDEX "BetaFeedback_createdAt_idx" ON "BetaFeedback"("createdAt");
