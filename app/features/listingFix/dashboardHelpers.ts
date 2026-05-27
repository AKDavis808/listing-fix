import type { BadgeProps } from "@shopify/polaris";

import type { ProductAuditOutcome } from "../../services/productAudit.server";
import type { ClientCatalogProductRow } from "../../services/listingProducts.server";
import type { IssueRecommendationPair } from "../../services/productRecommendations.server";

/** Row returned after `/app` scan POST (audit + recommendations, in-memory only). */
export type AuditedCatalogProductRow = ClientCatalogProductRow &
  ProductAuditOutcome & {
    recommendations: IssueRecommendationPair[];
  };

export type StoredProductAudit = ProductAuditOutcome & {
  recommendations: IssueRecommendationPair[];
};

export const DASHBOARD_AGGREGATE_NO_ISSUE_LABEL = "No issues detected";

/** Safest string for Polaris children (avoids invalid React children). */
export function safeDisplayText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

export type DashboardCatalogFilter =
  | { mode: "none" }
  | { mode: "scanned" }
  | { mode: "lowest_score" }
  | { mode: "needs_attention" }
  | { mode: "top_issue"; issue: string };

/** Coerce filter for render — invalid state becomes `none`. */
export function normalizeDashboardFilter(
  filter: DashboardCatalogFilter,
): DashboardCatalogFilter {
  if (filter == null || typeof filter !== "object") {
    return { mode: "none" };
  }

  switch (filter.mode) {
    case "none":
    case "scanned":
    case "lowest_score":
    case "needs_attention":
      return { mode: filter.mode };
    case "top_issue": {
      const issue =
        typeof filter.issue === "string" ? filter.issue.trim() : "";
      if (
        issue.length === 0 ||
        issue === DASHBOARD_AGGREGATE_NO_ISSUE_LABEL
      ) {
        return { mode: "none" };
      }
      return { mode: "top_issue", issue };
    }
    default:
      return { mode: "none" };
  }
}

/** Strip stack traces / huge blobs from shopper-facing banners. Logs detail to console. */
export function merchantFacingError(raw: unknown, ctx: string): string {
  const text =
    typeof raw === "string"
      ? raw.trim()
      : raw != null && typeof (raw as { message?: unknown }).message === "string"
        ? String((raw as { message: string }).message).trim()
        : "";

  if (!text) {
    console.warn(`[ListingFix:${ctx}] Empty error`);
    return "Something went wrong. Wait a moment and try again.";
  }

  const looksTechnical =
    /^\s*(Error|TypeError|ReferenceError):/i.test(text) ||
    /\sat\s\S+\([^)]*\)/m.test(text) ||
    /\n\s+at\s/.test(text);

  const networkish =
    /network|ECONNRESET|ECONNREFUSED|fetch.*fail|timed?\s?out|failed to fetch/i.test(
      text,
    );

  if (looksTechnical || text.length > 320) {
    console.warn(`[ListingFix:${ctx}]`, text);
    if (networkish) {
      return "We couldn't reach Shopify or the network dropped. Check your connection and try again.";
    }
    return "We couldn't finish that request. Try again in a moment. If this keeps happening, reload the page.";
  }

  return text;
}

export function statusTone(
  status: string | null | undefined,
): BadgeProps["tone"] | undefined {
  const normalized = String(status ?? "")
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/\./g, "_");
  switch (normalized) {
    case "ACTIVE":
      return "success";
    case "DRAFT":
      return "attention";
    case "ARCHIVED":
      return undefined;
    default:
      return "info";
  }
}

export function scoreTone(score: number): Exclude<BadgeProps["tone"], undefined> {
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "critical";
}

export function safeAuditScore(
  audit: StoredProductAudit | undefined | null,
): number {
  if (
    audit == null ||
    typeof audit.score !== "number" ||
    !Number.isFinite(audit.score)
  ) {
    return 0;
  }
  return audit.score;
}

export function coerceStoredAuditFromRow(
  row: AuditedCatalogProductRow,
): StoredProductAudit {
  const issues = Array.isArray(row.issues)
    ? row.issues.filter((i): i is string => typeof i === "string")
    : [];
  const recommendations = Array.isArray(row.recommendations)
    ? row.recommendations.filter(
        (r): r is IssueRecommendationPair =>
          r != null &&
          typeof r === "object" &&
          typeof (r as IssueRecommendationPair).issue === "string" &&
          typeof (r as IssueRecommendationPair).recommendation === "string",
      )
    : [];

  let score =
    typeof row.score === "number" && Number.isFinite(row.score)
      ? row.score
      : 0;

  score = Math.max(0, Math.min(100, score));

  const topIssue =
    typeof row.topIssue === "string" ? row.topIssue.trim() : "";

  return {
    score,
    issues,
    topIssue,
    recommendations,
  };
}

export function safeIssuesList(
  audit: StoredProductAudit | undefined | null,
): string[] {
  return Array.isArray(audit?.issues)
    ? audit.issues.filter((i): i is string => typeof i === "string")
    : [];
}

export function sortProductsForTable(
  products: ClientCatalogProductRow[],
  auditMap: Record<string, StoredProductAudit>,
): ClientCatalogProductRow[] {
  if (!products.length) return [];

  const copy = [...products];
  copy.sort((a, b) => {
    const au = auditMap[a.id];
    const bu = auditMap[b.id];
    const aDone = au != null;
    const bDone = bu != null;
    if (aDone !== bDone) {
      return aDone ? -1 : 1;
    }
    if (aDone && bDone && au && bu) {
      const as = safeAuditScore(au);
      const bs = safeAuditScore(bu);
      if (as !== bs) {
        return as - bs;
      }
      const ta = typeof a.title === "string" ? a.title : "";
      const tb = typeof b.title === "string" ? b.title : "";
      if (ta !== tb) {
        return ta.localeCompare(tb);
      }
    }
    return products.indexOf(a) - products.indexOf(b);
  });
  return copy;
}

export function catalogFilterBadgeTone(
  filter: DashboardCatalogFilter,
): NonNullable<BadgeProps["tone"]> {
  switch (filter.mode) {
    case "top_issue":
      return "attention";
    case "needs_attention":
      return "warning";
    case "scanned":
    case "lowest_score":
      return "info";
    default:
      return "info";
  }
}

export function catalogFilterBadgeLabel(
  filter: DashboardCatalogFilter,
): string {
  if (filter.mode === "none") {
    return "";
  }

  switch (filter.mode) {
    case "scanned":
      return "Products scanned";
    case "lowest_score":
      return "Lowest scores first";
    case "needs_attention":
      return "Needs attention (<80)";
    case "top_issue": {
      const issueText =
        typeof filter.issue === "string" ? filter.issue.trim() : "";
      if (!issueText.length) return "Most common issue";
      const short =
        issueText.length > 64
          ? `${issueText.slice(0, 63)}…`
          : issueText;
      return short;
    }
    default:
      return "";
  }
}

export function filterCatalogRowsByDashboard(
  orderedProducts: ClientCatalogProductRow[],
  audits: Record<string, StoredProductAudit>,
  filter: DashboardCatalogFilter,
): ClientCatalogProductRow[] {
  if (filter.mode === "none" || filter.mode === "lowest_score") {
    return orderedProducts;
  }

  const matchProduct = (p: ClientCatalogProductRow): boolean => {
    const a = audits[p.id];
    switch (filter.mode) {
      case "scanned":
        return a != null;
      case "needs_attention": {
        if (a == null) return false;
        const s = safeAuditScore(a);
        return s < 80;
      }
      case "top_issue": {
        if (a == null) return false;
        const target =
          typeof filter.issue === "string" ? filter.issue.trim() : "";
        if (!target.length) return false;
        return safeIssuesList(a).some(
          (issue) => issue.trim() === target,
        );
      }
      default:
        return true;
    }
  };

  return orderedProducts.filter(matchProduct);
}

export function computeDashboardStats(
  products: ClientCatalogProductRow[],
  auditMap: Record<string, StoredProductAudit>,
): {
  scannedCount: number;
  avgScore: number | null;
  needsAttention: number;
  topIssue: string;
} {
  const audited = products.filter((p) => auditMap[p.id] != null);
  const n = audited.length;

  if (n === 0) {
    return {
      scannedCount: 0,
      avgScore: null,
      needsAttention: 0,
      topIssue: DASHBOARD_AGGREGATE_NO_ISSUE_LABEL,
    };
  }

  let sumScores = 0;
  let needsAttention = 0;
  const issueFreq = new Map<string, number>();

  for (const p of audited) {
    const a = auditMap[p.id];
    if (a == null) continue;
    const score = safeAuditScore(a);
    sumScores += score;
    if (score < 80) {
      needsAttention += 1;
    }
    for (const issue of safeIssuesList(a)) {
      const key = issue.trim();
      if (!key.length) continue;
      issueFreq.set(key, (issueFreq.get(key) ?? 0) + 1);
    }
  }

  let topIssue = DASHBOARD_AGGREGATE_NO_ISSUE_LABEL;
  if (issueFreq.size > 0) {
    const sorted = [...issueFreq.entries()].sort(
      (x, y) => y[1] - x[1] || x[0].localeCompare(y[0]),
    );
    topIssue = sorted[0]?.[0] ?? DASHBOARD_AGGREGATE_NO_ISSUE_LABEL;
  }

  return {
    scannedCount: n,
    avgScore: Math.round(sumScores / n),
    needsAttention,
    topIssue,
  };
}

function isStoredAudit(value: unknown): value is StoredProductAudit {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const scoreOk =
    typeof v.score === "number" && Number.isFinite(v.score);
  const issuesOk = Array.isArray(v.issues) &&
    v.issues.every((i) => typeof i === "string");
  const topOk = typeof v.topIssue === "string";
  const recOk = Array.isArray(v.recommendations) &&
    v.recommendations.every(
      (r) =>
        r != null &&
        typeof r === "object" &&
        typeof (r as { issue?: unknown }).issue === "string" &&
        typeof (r as { recommendation?: unknown }).recommendation === "string",
    );
  return scoreOk && issuesOk && topOk && recOk;
}

/** Clamp persisted audits to product IDs from the loader (drops stale catalogs). */
export function filterAuditsToProductIds(
  audits: Record<string, StoredProductAudit>,
  productIds: string[],
): Record<string, StoredProductAudit> {
  const allow = new Set(productIds.filter((id) => id.length));
  const out: Record<string, StoredProductAudit> = {};
  for (const id of allow) {
    if (audits[id] != null && isStoredAudit(audits[id])) {
      out[id] = audits[id]!;
    }
  }
  return out;
}

export function parseStoredAuditsBlob(
  raw: unknown,
): Record<string, StoredProductAudit> | null {
  if (raw == null || typeof raw !== "object") return null;
  const entries = raw as Record<string, unknown>;
  const out: Record<string, StoredProductAudit> = {};
  for (const [id, val] of Object.entries(entries)) {
    if (!id.length || !isStoredAudit(val)) continue;
    out[id] = val;
  }
  return out;
}

export function parseDashboardFilterBlob(
  raw: unknown,
): DashboardCatalogFilter | null {
  if (raw == null || typeof raw !== "object") return null;
  const m = (raw as { mode?: unknown }).mode;
  if (m === "none") return { mode: "none" };
  if (m === "scanned") return { mode: "scanned" };
  if (m === "lowest_score") return { mode: "lowest_score" };
  if (m === "needs_attention") return { mode: "needs_attention" };
  if (m === "top_issue") {
    const issue =
      typeof (raw as { issue?: unknown }).issue === "string"
        ? (raw as { issue: string }).issue
        : "";
    return normalizeDashboardFilter({ mode: "top_issue", issue });
  }
  return null;
}
