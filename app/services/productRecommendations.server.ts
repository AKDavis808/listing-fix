/**
 * Merchant-facing deterministic fix guidance (no AI).
 * Keys must match `auditIssueMessages` strings from productAudit.server.ts.
 */

import { auditIssueMessages } from "./productAudit.server";

export type IssueRecommendationPair = {
  issue: string;
  recommendation: string;
};

type KnownIssueCopy =
  (typeof auditIssueMessages)[keyof typeof auditIssueMessages];

const RECOMMENDATIONS: Record<KnownIssueCopy, string> = {
  [auditIssueMessages.missingDescription]:
    "Add a detailed product description explaining features, materials, sizing, and benefits.",

  [auditIssueMessages.descriptionTooShort]:
    "Expand the product description to at least 150 characters with more product details.",

  [auditIssueMessages.noTags]:
    "Add descriptive tags to improve organization and discoverability.",

  [auditIssueMessages.weakTitle]:
    "Use a clearer title that includes product type, brand, material, or key feature.",

  [auditIssueMessages.missingProductType]:
    "Assign a product type/category for better filtering and organization.",

  [auditIssueMessages.noVariants]:
    "Add variants if the product comes in multiple sizes, colors, or options.",
};

const GENERIC_FALLBACK =
  "Review this item in Shopify Admin and address the flagged listing quality signals.";

/** One deterministic recommendation row per audit issue (order preserved). */
export function recommendationsForIssues(
  issues: readonly string[],
): IssueRecommendationPair[] {
  return issues.map((issue) => ({
    issue,
    recommendation: RECOMMENDATIONS[issue as KnownIssueCopy] ?? GENERIC_FALLBACK,
  }));
}
