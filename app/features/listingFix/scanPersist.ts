/**
 * Persist last scan audits + Overview filter across full page refreshes only.
 * sessionStorage clears when the tab closes — appropriate for ephemeral audit UX.
 */

import type { DashboardCatalogFilter, StoredProductAudit } from "./dashboardHelpers";
import {
  filterAuditsToProductIds,
  normalizeDashboardFilter,
  parseDashboardFilterBlob,
  parseStoredAuditsBlob,
} from "./dashboardHelpers";

const STORAGE_KEY_BASE = "listingfix:dashboard:v1";

function storageKey(fingerprint: string): string {
  return `${STORAGE_KEY_BASE}:${fingerprint}`;
}

export function loadPersistedDashboard(
  fingerprint: string,
  productIds: string[],
): {
  audits: Record<string, StoredProductAudit>;
  filter: DashboardCatalogFilter;
} | null {
  if (typeof window === "undefined" || !fingerprint.length) return null;

  try {
    const raw = sessionStorage.getItem(storageKey(fingerprint));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed == null ||
      typeof parsed !== "object" ||
      (parsed as { v?: unknown }).v !== 1
    )
      return null;

    const auditsRaw = (parsed as { audits?: unknown }).audits;
    const filterRaw = (parsed as { filter?: unknown }).filter;

    const auditsBlob = parseStoredAuditsBlob(auditsRaw);
    if (!auditsBlob || Object.keys(auditsBlob).length === 0) return null;

    const audits = filterAuditsToProductIds(auditsBlob, productIds);
    if (Object.keys(audits).length === 0) return null;

    const filterGuess = parseDashboardFilterBlob(filterRaw);
    const filter = normalizeDashboardFilter(filterGuess ?? { mode: "none" });

    return { audits, filter };
  } catch (e) {
    console.warn("[ListingFix:persist] load failed", e);
    return null;
  }
}

export function persistDashboardSnapshot(
  fingerprint: string,
  audits: Record<string, StoredProductAudit>,
  filter: DashboardCatalogFilter,
): void {
  if (typeof window === "undefined" || !fingerprint.length) return;
  try {
    if (Object.keys(audits).length === 0) {
      sessionStorage.removeItem(storageKey(fingerprint));
      return;
    }
    const payload = {
      v: 1 as const,
      audits,
      filter: normalizeDashboardFilter(filter),
    };
    sessionStorage.setItem(storageKey(fingerprint), JSON.stringify(payload));
  } catch (e) {
    console.warn("[ListingFix:persist] save failed", e);
  }
}

export function clearPersistedDashboard(fingerprint: string): void {
  if (typeof window === "undefined" || !fingerprint.length) return;
  try {
    sessionStorage.removeItem(storageKey(fingerprint));
  } catch {
    /* ignore */
  }
}
