import type { Prisma } from "@prisma/client";

import prisma from "../../db.server";
import type { AuditedCatalogProductRow } from "./dashboardHelpers";
import {
  coerceStoredAuditFromRow,
  computeDashboardStats,
  filterAuditsToProductIds,
  normalizeDashboardFilter,
  parseDashboardFilterBlob,
  parseStoredAuditsBlob,
  safeIssuesList,
  type DashboardCatalogFilter,
  type StoredProductAudit,
} from "./dashboardHelpers";
import { logListingFixEvent } from "./telemetry";
import {
  MAX_SCAN_HISTORY_PER_SHOP,
  buildScanSummaryText,
  type CatalogScanSessionSummary,
  type ScanResultsPayloadV1,
} from "./scanHistoryTypes";

function auditsFromAuditedRows(
  audited: AuditedCatalogProductRow[],
): Record<string, StoredProductAudit> {
  const out: Record<string, StoredProductAudit> = {};
  for (const row of audited) {
    if (!row?.id || typeof row.id !== "string") continue;
    out[row.id] = coerceStoredAuditFromRow(row);
  }
  return out;
}

function countTotalIssues(audits: Record<string, StoredProductAudit>): number {
  let total = 0;
  for (const audit of Object.values(audits)) {
    total += safeIssuesList(audit).length;
  }
  return total;
}

export function buildScanResultsPayload(input: {
  audited: AuditedCatalogProductRow[];
  products: { id: string }[];
  dashboardFilter?: DashboardCatalogFilter;
  catalogFingerprint: string;
}): ScanResultsPayloadV1 {
  const audits = auditsFromAuditedRows(input.audited);
  const statsFromDashboard = computeDashboardStats(input.products, audits);

  return {
    v: 1,
    catalogFingerprint: input.catalogFingerprint,
    dashboardFilter: normalizeDashboardFilter(
      input.dashboardFilter ?? { mode: "none" },
    ),
    audits,
    stats: {
      productCount: statsFromDashboard.scannedCount,
      issueCount: countTotalIssues(audits),
      averageScore: statsFromDashboard.avgScore,
      needsAttention: statsFromDashboard.needsAttention,
      topIssue: statsFromDashboard.topIssue,
    },
  };
}

function parseScanResultsPayload(raw: unknown): ScanResultsPayloadV1 | null {
  if (raw == null || typeof raw !== "object") return null;
  const v = (raw as { v?: unknown }).v;
  if (v !== 1) return null;

  const auditsRaw = (raw as { audits?: unknown }).audits;
  const audits = parseStoredAuditsBlob(auditsRaw);
  if (!audits || Object.keys(audits).length === 0) return null;

  const filterRaw = (raw as { dashboardFilter?: unknown }).dashboardFilter;
  const dashboardFilter = normalizeDashboardFilter(
    parseDashboardFilterBlob(filterRaw) ?? { mode: "none" },
  );

  const statsRaw = (raw as { stats?: unknown }).stats;
  const statsObj =
    statsRaw != null && typeof statsRaw === "object"
      ? (statsRaw as Record<string, unknown>)
      : {};

  const catalogFingerprint =
    typeof (raw as { catalogFingerprint?: unknown }).catalogFingerprint ===
    "string"
      ? (raw as { catalogFingerprint: string }).catalogFingerprint
      : "";

  return {
    v: 1,
    catalogFingerprint,
    dashboardFilter,
    audits,
    stats: {
      productCount:
        typeof statsObj.productCount === "number"
          ? Math.max(0, Math.trunc(statsObj.productCount))
          : Object.keys(audits).length,
      issueCount:
        typeof statsObj.issueCount === "number"
          ? Math.max(0, Math.trunc(statsObj.issueCount))
          : countTotalIssues(audits),
      averageScore:
        typeof statsObj.averageScore === "number" &&
        Number.isFinite(statsObj.averageScore)
          ? Math.trunc(statsObj.averageScore)
          : null,
      needsAttention:
        typeof statsObj.needsAttention === "number"
          ? Math.max(0, Math.trunc(statsObj.needsAttention))
          : 0,
      topIssue:
        typeof statsObj.topIssue === "string" ? statsObj.topIssue : "",
    },
  };
}

function toSummary(row: {
  id: string;
  scanCompletedAt: Date | null;
  productCount: number;
  issueCount: number;
  averageScore: number | null;
  scanSummary: string | null;
  topIssue: string | null;
  scanDurationMs: number | null;
}): CatalogScanSessionSummary | null {
  if (!row.scanCompletedAt) return null;
  return {
    id: row.id,
    scanCompletedAt: row.scanCompletedAt.toISOString(),
    productCount: row.productCount,
    issueCount: row.issueCount,
    averageScore: row.averageScore,
    scanSummary: row.scanSummary,
    topIssue: row.topIssue,
    scanDurationMs: row.scanDurationMs,
  };
}

export async function listRecentScanSessions(
  shopDomain: string,
  limit = 10,
): Promise<CatalogScanSessionSummary[]> {
  const rows = await prisma.catalogScanSession.findMany({
    where: { shopDomain, scanCompletedAt: { not: null } },
    orderBy: { scanCompletedAt: "desc" },
    take: limit,
    select: {
      id: true,
      scanCompletedAt: true,
      productCount: true,
      issueCount: true,
      averageScore: true,
      scanSummary: true,
      topIssue: true,
      scanDurationMs: true,
    },
  });

  return rows
    .map((row) => toSummary(row))
    .filter((row): row is CatalogScanSessionSummary => row != null);
}

export async function saveCatalogScanSession(input: {
  shopDomain: string;
  audited: AuditedCatalogProductRow[];
  products: { id: string }[];
  catalogFingerprint: string;
  dashboardFilter?: DashboardCatalogFilter;
  scanStartedAt: Date;
  scanDurationMs: number;
}): Promise<string | null> {
  try {
    const payload = buildScanResultsPayload(input);
    const scanSummary = buildScanSummaryText(payload.stats);

    const created = await prisma.catalogScanSession.create({
      data: {
        shopDomain: input.shopDomain,
        scanStartedAt: input.scanStartedAt,
        scanCompletedAt: new Date(),
        productCount: payload.stats.productCount,
        issueCount: payload.stats.issueCount,
        averageScore: payload.stats.averageScore,
        scanSummary,
        scanResultsJson: payload as unknown as Prisma.InputJsonValue,
        catalogFingerprint: input.catalogFingerprint,
        dashboardFilterJson:
          payload.dashboardFilter as unknown as Prisma.InputJsonValue,
        scanDurationMs: Math.max(0, Math.round(input.scanDurationMs)),
        topIssue: payload.stats.topIssue || null,
        improvementCount: payload.stats.needsAttention,
      },
      select: { id: true },
    });

    const deletedCount = await pruneOldScanSessions(input.shopDomain);

    logListingFixEvent({
      action: "scan_saved",
      shop: input.shopDomain,
      meta: {
        sessionId: created.id,
        productCount: payload.stats.productCount,
        deletedOldSessions: deletedCount,
      },
    });

    return created.id;
  } catch (error) {
    logListingFixEvent({
      action: "scan_failure",
      shop: input.shopDomain,
      message: error,
      meta: { phase: "scan_save" },
    });
    return null;
  }
}

export async function pruneOldScanSessions(shopDomain: string): Promise<number> {
  const sessions = await prisma.catalogScanSession.findMany({
    where: { shopDomain },
    orderBy: { scanCompletedAt: "desc" },
    select: { id: true },
  });

  if (sessions.length <= MAX_SCAN_HISTORY_PER_SHOP) {
    return 0;
  }

  const staleIds = sessions
    .slice(MAX_SCAN_HISTORY_PER_SHOP)
    .map((session) => session.id);

  if (staleIds.length === 0) return 0;

  const result = await prisma.catalogScanSession.deleteMany({
    where: { id: { in: staleIds }, shopDomain },
  });

  if (result.count > 0) {
    logListingFixEvent({
      action: "scan_deleted",
      shop: shopDomain,
      meta: { deletedCount: result.count },
    });
  }

  return result.count;
}

export async function restoreCatalogScanSession(input: {
  shopDomain: string;
  sessionId: string;
  productIds: string[];
}): Promise<
  | { ok: true; payload: ScanResultsPayloadV1; session: CatalogScanSessionSummary }
  | { ok: false; error: string }
> {
  const row = await prisma.catalogScanSession.findFirst({
    where: { id: input.sessionId, shopDomain: input.shopDomain },
  });

  if (!row) {
    return { ok: false, error: "That scan could not be found." };
  }

  const payload = parseScanResultsPayload(row.scanResultsJson);
  if (!payload) {
    return { ok: false, error: "Saved scan data is unavailable." };
  }

  const audits = filterAuditsToProductIds(payload.audits, input.productIds);
  if (Object.keys(audits).length === 0) {
    return {
      ok: false,
      error:
        "This scan no longer matches your current catalog. Run a fresh scan instead.",
    };
  }

  const restoredPayload: ScanResultsPayloadV1 = {
    ...payload,
    audits,
    dashboardFilter: normalizeDashboardFilter(
      parseDashboardFilterBlob(row.dashboardFilterJson) ??
        payload.dashboardFilter,
    ),
  };

  const session =
    toSummary({
      id: row.id,
      scanCompletedAt: row.scanCompletedAt,
      productCount: row.productCount,
      issueCount: row.issueCount,
      averageScore: row.averageScore,
      scanSummary: row.scanSummary,
      topIssue: row.topIssue,
      scanDurationMs: row.scanDurationMs,
    }) ?? null;

  if (!session) {
    return { ok: false, error: "That scan is still processing." };
  }

  logListingFixEvent({
    action: "scan_restored",
    shop: input.shopDomain,
    meta: {
      sessionId: row.id,
      restoredProductCount: Object.keys(audits).length,
    },
  });

  return { ok: true, payload: restoredPayload, session };
}
