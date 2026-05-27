import type { DashboardCatalogFilter, StoredProductAudit } from "./dashboardHelpers";

export const MAX_SCAN_HISTORY_PER_SHOP = 25;

export type ScanResultsPayloadV1 = {
  v: 1;
  catalogFingerprint: string;
  dashboardFilter: DashboardCatalogFilter;
  audits: Record<string, StoredProductAudit>;
  stats: {
    productCount: number;
    issueCount: number;
    averageScore: number | null;
    needsAttention: number;
    topIssue: string;
  };
};

export type CatalogScanSessionSummary = {
  id: string;
  scanCompletedAt: string;
  productCount: number;
  issueCount: number;
  averageScore: number | null;
  scanSummary: string | null;
  topIssue: string | null;
  scanDurationMs: number | null;
};

export function formatScanSessionLabel(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "Previous scan";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Previous scan";
  }
}

export function buildScanSummaryText(stats: ScanResultsPayloadV1["stats"]): string {
  const avg =
    stats.averageScore == null ? "—" : `${stats.averageScore}/100 average score`;
  return `${stats.productCount} products · ${stats.issueCount} issues · ${avg}`;
}
