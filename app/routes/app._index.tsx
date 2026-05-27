import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import type { ReactNode } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  Divider,
  EmptyState,
  InlineGrid,
  InlineStack,
  Layout,
  List,
  Modal,
  Page,
  SkeletonBodyText,
  Spinner,
  Text,
} from "@shopify/polaris";

import { ListingFixDashboardMetricTile } from "../components/listingFix/ListingFixDashboardMetricTile";
import { ListingFixBetaUsageCard } from "../components/listingFix/ListingFixBetaUsageCard";
import { ListingFixBetaBadge } from "../components/listingFix/ListingFixBetaBadge";
import { ListingFixActionReassurance } from "../components/listingFix/ListingFixActionReassurance";
import { ListingFixFirstScanPrompt } from "../components/listingFix/ListingFixFirstScanPrompt";
import { ListingFixTrustPanel } from "../components/listingFix/ListingFixTrustPanel";
import { useListingFixFeedback } from "../components/listingFix/ListingFixFeedback";
import type { AuditedCatalogProductRow } from "../features/listingFix/dashboardHelpers";
import {
  DASHBOARD_AGGREGATE_NO_ISSUE_LABEL,
  catalogFilterBadgeLabel,
  catalogFilterBadgeTone,
  coerceStoredAuditFromRow,
  computeDashboardStats,
  filterCatalogRowsByDashboard,
  merchantFacingError,
  normalizeDashboardFilter,
  safeAuditScore,
  safeDisplayText,
  safeIssuesList,
  scoreTone,
  sortProductsForTable,
  statusTone,
  type DashboardCatalogFilter,
  type StoredProductAudit,
} from "../features/listingFix/dashboardHelpers";
import {
  loadPersistedDashboard,
  persistDashboardSnapshot,
} from "../features/listingFix/scanPersist";
import {
  endTimer,
  logListingFixEvent,
  startTimer,
} from "../features/listingFix/telemetry";
import {
  AI_LIMIT_MESSAGE,
  SCAN_LIMIT_MESSAGE,
  type ListingFixDailyUsageSnapshot,
} from "../features/listingFix/usageLimits";
import {
  getRemainingUsage,
  incrementScanUsage,
} from "../features/listingFix/usage.server";
import { listRecentScanSessions, saveCatalogScanSession } from "../features/listingFix/scanHistory.server";
import type { CatalogScanSessionSummary } from "../features/listingFix/scanHistoryTypes";
import { formatScanSessionLabel } from "../features/listingFix/scanHistoryTypes";
import { ListingFixScanHistoryPanel } from "../components/listingFix/ListingFixScanHistoryPanel";
import {
  FIRST_SCAN_BODY,
  FIRST_SCAN_HEADING,
  REASSURANCE,
  AI_DISCLOSURE,
} from "../features/listingFix/trustCopy";

import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  auditProduct,
} from "../services/productAudit.server";
import {
  fetchCatalogProducts,
  toClientCatalogRow,
  type ClientCatalogProductRow,
} from "../services/listingProducts.server";
import {
  recommendationsForIssues,
  type IssueRecommendationPair,
} from "../services/productRecommendations.server";

import type { AiSuggestionsActionData } from "./app.ai-suggestions";
import type {
  ApplyListingFieldActionData,
  ApplyListingFieldKind,
} from "./app.apply-listing-field";
import type { RestoreScanActionData } from "./app.scan-history";

const APPLY_FIELD_LABELS: Record<ApplyListingFieldKind, string> = {
  title: "Suggested title",
  description: "Suggested description",
  tags: "Suggested tags",
  seo: "SEO meta description",
};

function formatApplyConfirmation(field: ApplyListingFieldKind): string {
  switch (field) {
    case "title":
      return "Product title updated in Shopify.";
    case "description":
      return "Product description updated in Shopify.";
    case "tags":
      return "Product tags updated in Shopify.";
    case "seo":
      return "SEO meta description updated in Shopify.";
    default:
      field satisfies never;
      return "";
  }
}

/** Row returned after `/app` scan POST (audit + recommendations, in-memory only). */
type LoaderFailure = {
  ok: false;
  errorMessage: string;
  products: [];
  shop: string;
  usage: ListingFixDailyUsageSnapshot;
  scanHistory: CatalogScanSessionSummary[];
};

type LoaderSuccess = {
  ok: true;
  errorMessage: null;
  products: ClientCatalogProductRow[];
  shop: string;
  usage: ListingFixDailyUsageSnapshot;
  scanHistory: CatalogScanSessionSummary[];
};

export type ListingFixHomeLoaderData = LoaderFailure | LoaderSuccess;

type AuditActionFail = {
  ok: false;
  errorMessage: string;
  limitKind?: "scan";
};

type AuditActionSuccess = {
  ok: true;
  audited: AuditedCatalogProductRow[];
  sessionId?: string;
};

export type ListingFixAuditActionData =
  | AuditActionFail
  | AuditActionSuccess
  | null;

export type { DashboardCatalogFilter } from "../features/listingFix/dashboardHelpers";

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<ListingFixHomeLoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const usage = await getRemainingUsage(shop);
  const scanHistory = await listRecentScanSessions(shop);
  const timer = startTimer("load-catalog");

  const result = await fetchCatalogProducts(admin, 25);
  if (!result.ok) {
    logListingFixEvent({
      action: "catalog_load_failure",
      shop,
      durationMs: endTimer(timer),
      message: result.errorMessage,
    });
    return {
      ok: false,
      errorMessage: result.errorMessage,
      products: [],
      shop,
      usage,
      scanHistory,
    };
  }

  return {
    ok: true,
    errorMessage: null,
    products: result.products.map(toClientCatalogRow),
    shop,
    usage,
    scanHistory,
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ListingFixAuditActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const timer = startTimer("scan-products");
  const scanStartedAt = new Date();
  logListingFixEvent({ action: "scan_start", shop });

  const formData = await request.formData();

  if (formData.get("intent") !== "audit") {
    return null;
  }

  try {
    const usageGate = await incrementScanUsage(shop);
    if (!usageGate.ok) {
      logListingFixEvent({
        action: "scan_failure",
        shop,
        durationMs: endTimer(timer),
        message: usageGate.message,
        meta: { limitKind: usageGate.limitKind },
      });
      return {
        ok: false,
        errorMessage: usageGate.message,
        limitKind: "scan",
      };
    }

    const result = await fetchCatalogProducts(admin, 25);
    if (!result.ok) {
      logListingFixEvent({
        action: "scan_failure",
        shop,
        durationMs: endTimer(timer),
        message: result.errorMessage,
      });
      return { ok: false, errorMessage: result.errorMessage };
    }

    const audited: AuditedCatalogProductRow[] = result.products.map((p) => {
      const audit = auditProduct({
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        productType: p.productType,
        tags: p.tags,
        variantsCount: p.variantsCount,
      });
      const recommendations = recommendationsForIssues(audit.issues);
      return { ...toClientCatalogRow(p), ...audit, recommendations };
    });

    const productRows = audited.map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
    }));
    const catalogFingerprint = productRows
      .map((row) => row.id)
      .filter(Boolean)
      .join("|");
    const durationMs = endTimer(timer);

    const sessionId = await saveCatalogScanSession({
      shopDomain: shop,
      audited,
      products: productRows.filter((row) => row.id.length > 0),
      catalogFingerprint,
      scanStartedAt,
      scanDurationMs: durationMs,
    });

    logListingFixEvent({
      action: "scan_success",
      shop,
      durationMs,
      meta: { productCount: audited.length, sessionId },
    });

    return { ok: true, audited, sessionId: sessionId ?? undefined };
  } catch (error) {
    logListingFixEvent({
      action: "scan_failure",
      shop,
      durationMs: endTimer(timer),
      message: error,
    });
    throw error;
  }
};

const EMPTY_CATALOG_IMG =
  "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

export default function ListingFixHomePage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ListingFixAuditActionData>();
  const historyFetcher = useFetcher<RestoreScanActionData>();
  const aiFetcher = useFetcher<AiSuggestionsActionData>();
  const applyFetcher = useFetcher<ApplyListingFieldActionData>();

  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const navigation = useNavigation();

  const [trackedApplyField, setTrackedApplyField] =
    useState<ApplyListingFieldKind | null>(null);
  const [applyOutcomeBanner, setApplyOutcomeBanner] = useState<
    | {
        tone: "success" | "critical";
        title: string;
        detail: string;
      }
    | null
  >(null);
  const [applySuccessBadgeField, setApplySuccessBadgeField] =
    useState<ApplyListingFieldKind | null>(null);

  const applySeqCounterRef = useRef(0);
  const expectedListingApplyTokenRef = useRef<string | null>(null);
  const lastScanResultRef = useRef<ListingFixAuditActionData | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof startTimer> | null>(null);
  const lastLoggedScanFailureRef = useRef<ListingFixAuditActionData | null>(null);
  const lastLoggedAiOutcomeRef = useRef<AiSuggestionsActionData | null>(null);
  const lastLoggedApplyOutcomeRef = useRef<ApplyListingFieldActionData | null>(null);

  /** Scroll/highlight: anchored modal region + transient pulse + ledger per catalog product ID. */
  const aiResultsAnchorRef = useRef<HTMLDivElement | null>(null);
  const aiSuggestionRoundRef = useRef(0);
  const lastHandledAiScrollTokenByProductRef = useRef<
    Partial<Record<string, string>>
  >({});
  const aiHighlightDismissTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const [highlightFreshAiSuggestions, setHighlightFreshAiSuggestions] =
    useState(false);

  const [auditByProductId, setAuditByProductId] = useState<
    Record<string, StoredProductAudit>
  >({});
  const [dashboardFilter, setDashboardFilter] =
    useState<DashboardCatalogFilter>({ mode: "none" });
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [activeScanSessionId, setActiveScanSessionId] = useState<string | null>(
    null,
  );
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(
    null,
  );

  const lastRestoreResultRef = useRef<RestoreScanActionData | null>(null);

  const dashboardFilterRef = useRef(dashboardFilter);
  dashboardFilterRef.current = dashboardFilter;

  const dashboardFilterForUi = useMemo(
    () => normalizeDashboardFilter(dashboardFilter),
    [dashboardFilter],
  );

  useEffect(() => {
    const next = normalizeDashboardFilter(dashboardFilter);
    const same =
      dashboardFilter.mode === next.mode &&
      (next.mode !== "top_issue" ||
        (dashboardFilter.mode === "top_issue" &&
          typeof dashboardFilter.issue === "string" &&
          dashboardFilter.issue.trim() === next.issue));
    if (!same) {
      setDashboardFilter(next);
    }
  }, [dashboardFilter]);

  const fingerprint = data.ok ? data.products.map((p) => p.id).join("|") : "";

  const shopDomain = data.shop;

  useEffect(() => {
    if (!data.ok || !fingerprint.length) {
      setAuditByProductId({});
      setDashboardFilter({ mode: "none" });
      return;
    }

    const productIds = data.products
      .map((p) => p.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const saved = loadPersistedDashboard(fingerprint, productIds);
    if (saved) {
      setAuditByProductId(saved.audits);
      setDashboardFilter(saved.filter);
      return;
    }

    setAuditByProductId({});
    setDashboardFilter({ mode: "none" });
  }, [data.ok, fingerprint]);

  useEffect(() => {
    if (!fingerprint.length || Object.keys(auditByProductId).length === 0) {
      return;
    }
    persistDashboardSnapshot(
      fingerprint,
      auditByProductId,
      dashboardFilterForUi,
    );
  }, [auditByProductId, dashboardFilterForUi, fingerprint]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (!fetcher.data.ok) return;
    if (lastScanResultRef.current === fetcher.data) return;
    lastScanResultRef.current = fetcher.data;

    const next: Record<string, StoredProductAudit> = {};
    for (const row of fetcher.data.audited) {
      if (!row?.id || typeof row.id !== "string") continue;
      next[row.id] = coerceStoredAuditFromRow(row);
    }
    setAuditByProductId(next);
    persistDashboardSnapshot(
      fingerprint,
      next,
      normalizeDashboardFilter(dashboardFilterRef.current),
    );
    if (fetcher.data.sessionId) {
      setActiveScanSessionId(fetcher.data.sessionId);
    }
    logListingFixEvent({
      action: "scan_success",
      shop: shopDomain,
      durationMs: scanTimerRef.current
        ? endTimer(scanTimerRef.current)
        : undefined,
      meta: { productCount: Object.keys(next).length, source: "client" },
    });
    scanTimerRef.current = null;
    shopify.toast.show("Listing scan complete");
    void revalidator.revalidate();
  }, [fetcher.state, fetcher.data, fingerprint, revalidator, shopDomain, shopify]);

  const handleRestoreScan = useCallback(
    (sessionId: string) => {
      if (historyFetcher.state !== "idle") return;
      setRestoringSessionId(sessionId);
      const form = new FormData();
      form.set("intent", "restore-scan");
      form.set("sessionId", sessionId);
      historyFetcher.submit(form, {
        method: "post",
        action: "/app/scan-history",
      });
    },
    [historyFetcher],
  );

  useEffect(() => {
    if (historyFetcher.state !== "idle" || !historyFetcher.data) return;
    if (lastRestoreResultRef.current === historyFetcher.data) return;
    lastRestoreResultRef.current = historyFetcher.data;
    setRestoringSessionId(null);

    if (!historyFetcher.data.ok) {
      shopify.toast.show(
        merchantFacingError(historyFetcher.data.error, "restore-scan"),
        { isError: true },
      );
      return;
    }

    const { payload, session } = historyFetcher.data;
    setAuditByProductId(payload.audits);
    setDashboardFilter(normalizeDashboardFilter(payload.dashboardFilter));
    setActiveScanSessionId(session.id);
    persistDashboardSnapshot(
      fingerprint,
      payload.audits,
      normalizeDashboardFilter(payload.dashboardFilter),
    );
    shopify.toast.show("Earlier scan results restored");
    void revalidator.revalidate();
  }, [
    fingerprint,
    historyFetcher.data,
    historyFetcher.state,
    revalidator,
    shopify,
  ]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) return;
    if (lastLoggedScanFailureRef.current === fetcher.data) return;
    lastLoggedScanFailureRef.current = fetcher.data;

    logListingFixEvent({
      action: "scan_failure",
      shop: shopDomain,
      durationMs: scanTimerRef.current
        ? endTimer(scanTimerRef.current)
        : undefined,
      message: fetcher.data.errorMessage,
      meta: { source: "client" },
    });
    scanTimerRef.current = null;
  }, [fetcher.state, fetcher.data, shopDomain]);

  const handleScanProducts = useCallback(() => {
    if (fetcher.state !== "idle") return;
    if (data.usage.scansRemaining <= 0) return;
    scanTimerRef.current = startTimer("scan-products");
    logListingFixEvent({ action: "scan_start", shop: shopDomain, meta: { source: "client" } });
    const form = new FormData();
    form.set("intent", "audit");
    fetcher.submit(form, { method: "post" });
  }, [data.usage.scansRemaining, fetcher, shopDomain]);

  const openProductDetails = useCallback((id: string) => {
    setDetailProductId(id);
  }, []);

  const closeProductDetails = useCallback(() => setDetailProductId(null), []);

  const scanLimitReached = data.usage.scansRemaining <= 0;

  const scanLimitError =
    fetcher.state === "idle" &&
    fetcher.data &&
    !fetcher.data.ok &&
    fetcher.data.limitKind === "scan"
      ? SCAN_LIMIT_MESSAGE
      : null;

  const scanError =
    fetcher.state === "idle" &&
    fetcher.data &&
    !fetcher.data.ok &&
    fetcher.data.limitKind !== "scan"
      ? merchantFacingError(fetcher.data.errorMessage, "scan-products")
      : null;

  const catalogLoadError = !data.ok
    ? merchantFacingError(data.errorMessage, "load-catalog")
    : null;

  useEffect(() => {
    if (data.ok) return;
    logListingFixEvent({
      action: "catalog_load_failure",
      shop: shopDomain,
      message: data.errorMessage,
      meta: { source: "client" },
    });
  }, [data.errorMessage, data.ok, shopDomain]);

  const detailProduct =
    detailProductId != null && data.ok
      ? data.products.find((p) => p.id === detailProductId)
      : undefined;
  const detailAudit =
    detailProductId != null ? auditByProductId[detailProductId] : undefined;

  const aiGenerating = aiFetcher.state !== "idle";

  const aiIdleData =
    aiFetcher.state === "idle" ? (aiFetcher.data ?? null) : null;

  const aiSuccess =
    aiIdleData?.ok === true &&
    detailProductId !== null &&
    aiIdleData.productId === detailProductId;

  const aiFailure =
    aiIdleData?.ok === false &&
    detailProductId !== null &&
    (aiIdleData.productId === undefined ||
      aiIdleData.productId === detailProductId);

  const aiSuggestions = aiSuccess ? aiIdleData.suggestions : null;
  const aiLimitReached = data.usage.aiRemaining <= 0;

  const aiLimitError =
    aiFailure && aiIdleData?.limitKind === "ai" ? AI_LIMIT_MESSAGE : null;

  const aiErrorMessage =
    aiFailure && aiIdleData?.limitKind !== "ai"
      ? merchantFacingError(aiIdleData?.error, "ai-suggestions")
      : null;

  const applyInFlight = applyFetcher.state !== "idle";

  const aiTimerRef = useRef<ReturnType<typeof startTimer> | null>(null);
  const applyTimerRef = useRef<ReturnType<typeof startTimer> | null>(null);

  const handleGenerateAiSuggestions = useCallback(() => {
    if (!detailProductId || !detailAudit) return;
    if (aiFetcher.state !== "idle" || applyFetcher.state !== "idle") return;
    if (data.usage.aiRemaining <= 0) return;

    setHighlightFreshAiSuggestions(false);
    if (aiHighlightDismissTimerRef.current != null) {
      window.clearTimeout(aiHighlightDismissTimerRef.current);
      aiHighlightDismissTimerRef.current = null;
    }

    aiSuggestionRoundRef.current += 1;
    const requestToken = `lf_ai_${detailProductId}_${aiSuggestionRoundRef.current}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

    aiTimerRef.current = startTimer("ai-suggestions");
    logListingFixEvent({
      action: "ai_start",
      shop: shopDomain,
      productId: detailProductId,
      meta: { source: "client" },
    });

    const form = new FormData();
    form.set("intent", "ai-suggestions");
    form.set("productId", detailProductId);
    form.set("requestToken", requestToken);

    aiFetcher.submit(form, {
      method: "post",
      action: "/app/ai-suggestions",
    });
  }, [
    aiFetcher,
    applyFetcher.state,
    data.usage.aiRemaining,
    detailAudit,
    detailProductId,
    shopDomain,
  ]);

  useEffect(() => {
    setApplyOutcomeBanner(null);
    setHighlightFreshAiSuggestions(false);
    if (aiHighlightDismissTimerRef.current != null) {
      window.clearTimeout(aiHighlightDismissTimerRef.current);
      aiHighlightDismissTimerRef.current = null;
    }
  }, [detailProductId]);

  useEffect(() => {
    return () => {
      if (aiHighlightDismissTimerRef.current != null) {
        window.clearTimeout(aiHighlightDismissTimerRef.current);
        aiHighlightDismissTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!applySuccessBadgeField) return;
    const handle = window.setTimeout(() => {
      setApplySuccessBadgeField(null);
    }, 4000);
    return () => window.clearTimeout(handle);
  }, [applySuccessBadgeField]);

  /** After each NEW AI success, gently scroll modal content to suggestions + brief outline pulse. */
  useEffect(() => {
    if (aiFetcher.state !== "idle") return;

    const outcome = aiFetcher.data ?? null;
    if (!outcome) return;
    if (lastLoggedAiOutcomeRef.current === outcome) return;
    lastLoggedAiOutcomeRef.current = outcome;

    if (outcome.ok) {
      logListingFixEvent({
        action: "ai_success",
        shop: shopDomain,
        productId: outcome.productId,
        durationMs: aiTimerRef.current
          ? endTimer(aiTimerRef.current)
          : undefined,
        meta: { source: "client" },
      });
    } else {
      logListingFixEvent({
        action: "ai_failure",
        shop: shopDomain,
        productId: outcome.productId,
        durationMs: aiTimerRef.current
          ? endTimer(aiTimerRef.current)
          : undefined,
        message: outcome.error,
        meta: { source: "client" },
      });
    }
    aiTimerRef.current = null;
    void revalidator.revalidate();
  }, [aiFetcher.data, aiFetcher.state, revalidator, shopDomain]);

  useEffect(() => {
    if (aiFetcher.state !== "idle") return;

    const d = aiFetcher.data;
    if (!d?.ok || !detailProductId) return;
    if (d.productId !== detailProductId) return;

    const token =
      typeof d.requestToken === "string" ? d.requestToken.trim() : "";
    if (!token.length) return;

    const ledger = lastHandledAiScrollTokenByProductRef.current;
    if (ledger[detailProductId] === token) return;
    ledger[detailProductId] = token;

    queueMicrotask(() => {
      requestAnimationFrame(() => {
        aiResultsAnchorRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
          inline: "nearest",
        });
      });
    });

    setHighlightFreshAiSuggestions(true);
    if (aiHighlightDismissTimerRef.current != null) {
      window.clearTimeout(aiHighlightDismissTimerRef.current);
    }
    aiHighlightDismissTimerRef.current = window.setTimeout(() => {
      setHighlightFreshAiSuggestions(false);
      aiHighlightDismissTimerRef.current = null;
    }, 1750);
  }, [aiFetcher.data, aiFetcher.state, detailProductId]);

  useEffect(() => {
    if (applyFetcher.state !== "idle") return;

    const awaitedField = trackedApplyField;
    const response = applyFetcher.data ?? null;
    const expectedToken = expectedListingApplyTokenRef.current;

    if (!awaitedField) {
      expectedListingApplyTokenRef.current = null;
      return;
    }

    if (!response || !expectedToken) {
      expectedListingApplyTokenRef.current = null;
      setTrackedApplyField(null);
      return;
    }

    const tokenMatches = response.requestToken === expectedToken;
    const alignsWithModal =
      Boolean(response.productId && detailProductId) &&
      response.productId === detailProductId &&
      response.field === awaitedField;

    if (!tokenMatches || !alignsWithModal) {
      expectedListingApplyTokenRef.current = null;
      setTrackedApplyField(null);
      return;
    }

    expectedListingApplyTokenRef.current = null;
    setTrackedApplyField(null);

    if (lastLoggedApplyOutcomeRef.current !== response) {
      lastLoggedApplyOutcomeRef.current = response;
      if (response.ok) {
        logListingFixEvent({
          action: "apply_success",
          shop: shopDomain,
          productId: response.productId,
          durationMs: applyTimerRef.current
            ? endTimer(applyTimerRef.current)
            : undefined,
          meta: { field: response.field, source: "client" },
        });
      } else {
        logListingFixEvent({
          action: "apply_failure",
          shop: shopDomain,
          productId: response.productId,
          durationMs: applyTimerRef.current
            ? endTimer(applyTimerRef.current)
            : undefined,
          message: response.errorMessage,
          meta: { field: response.field, source: "client" },
        });
      }
      applyTimerRef.current = null;
    }

    if (response.ok) {
      shopify.toast.show(formatApplyConfirmation(response.field));
      setApplyOutcomeBanner({
        tone: "success",
        title: `${APPLY_FIELD_LABELS[response.field]} applied`,
        detail: `${formatApplyConfirmation(response.field)} The catalog refreshes automatically — scan again whenever you want up-to-date scores.`,
      });
      setApplySuccessBadgeField(response.field);
      void revalidator.revalidate();
    } else {
      const userErrText =
        response.userErrors?.map((entry) => entry.message).join(" ").trim() ??
        "";
      shopify.toast.show(
        merchantFacingError(response.errorMessage, "apply-listing-field"),
        { isError: true },
      );
      setApplyOutcomeBanner({
        tone: "critical",
        title: `${APPLY_FIELD_LABELS[response.field]} not saved`,
        detail: merchantFacingError(
          userErrText
            ? `${response.errorMessage} ${userErrText}`
            : response.errorMessage,
          "apply-listing-field",
        ),
      });
    }
  }, [
    applyFetcher.data,
    applyFetcher.state,
    detailProductId,
    revalidator,
    shopDomain,
    shopify,
    trackedApplyField,
  ]);

  const beginListingFieldApply = useCallback(
    (field: ApplyListingFieldKind, buildPayload: () => FormData | null) => {
      if (!detailProductId || applyFetcher.state !== "idle") return;
      const form = buildPayload();
      if (!form) return;

      applySeqCounterRef.current += 1;
      const token = `listingfix_${Date.now()}_${applySeqCounterRef.current}_${field}`;
      expectedListingApplyTokenRef.current = token;

      form.set("intent", "apply-listing-field");
      form.set("productId", detailProductId);
      form.set("field", field);
      form.set("requestToken", token);

      setApplyOutcomeBanner(null);
      setApplySuccessBadgeField(null);
      setTrackedApplyField(field);
      applyTimerRef.current = startTimer("apply-listing-field");
      logListingFixEvent({
        action: "apply_start",
        shop: shopDomain,
        productId: detailProductId,
        meta: { field, source: "client" },
      });
      applyFetcher.submit(form, {
        method: "post",
        action: "/app/apply-listing-field",
      });
    },
    [applyFetcher, detailProductId, shopDomain],
  );

  useEffect(() => {
    if (
      detailProductId != null &&
      data.ok &&
      !data.products.some((p) => p.id === detailProductId)
    ) {
      setDetailProductId(null);
    }
  }, [detailProductId, data]);

  const modalOpen = detailProduct != null;

  const dashboardStats = useMemo(
    () =>
      data.ok
        ? computeDashboardStats(data.products, auditByProductId)
        : {
            scannedCount: 0,
            avgScore: null as number | null,
            needsAttention: 0,
            topIssue: DASHBOARD_AGGREGATE_NO_ISSUE_LABEL,
          },
    [auditByProductId, data],
  );

  const topIssueLabel =
    typeof dashboardStats.topIssue === "string"
      ? dashboardStats.topIssue.trim()
      : "";

  const orderedProducts = useMemo(
    () =>
      data.ok
        ? sortProductsForTable(data.products, auditByProductId)
        : [],
    [auditByProductId, data],
  );

  const clearDashboardCatalogFilter = useCallback(() => {
    try {
      setDashboardFilter({ mode: "none" });
    } catch (error) {
      logListingFixEvent({
        action: "filter_interaction_error",
        shop: shopDomain,
        message: error,
        meta: { operation: "clear_filter" },
      });
    }
  }, [shopDomain]);

  const toggleDashboardCatalogSlice = useCallback(
    (
      slot:
        | "scanned_products"
        | "average_scores"
        | "needs_attention"
        | "most_common_issue",
      issueSeed?: string,
    ) => {
      try {
        setDashboardFilter((prev) => {
          switch (slot) {
            case "scanned_products":
              return prev.mode === "scanned"
                ? { mode: "none" }
                : { mode: "scanned" };
            case "average_scores":
              return prev.mode === "lowest_score"
                ? { mode: "none" }
                : { mode: "lowest_score" };
            case "needs_attention":
              return prev.mode === "needs_attention"
                ? { mode: "none" }
                : { mode: "needs_attention" };
            case "most_common_issue": {
              const issue =
                typeof issueSeed === "string" ? issueSeed.trim() : "";
              if (
                !issue.length ||
                issue === DASHBOARD_AGGREGATE_NO_ISSUE_LABEL
              ) {
                return prev;
              }
              const prevIssue =
                prev.mode === "top_issue"
                  ? (typeof prev.issue === "string" ? prev.issue.trim() : "")
                  : "";
              const same =
                prev.mode === "top_issue" && prevIssue === issue;
              return same ? { mode: "none" } : { mode: "top_issue", issue };
            }
            default:
              return prev;
          }
        });
      } catch (error) {
        logListingFixEvent({
          action: "filter_interaction_error",
          shop: shopDomain,
          message: error,
          meta: { operation: slot },
        });
      }
    },
    [shopDomain],
  );

  const catalogProductsForTable = useMemo(
    () =>
      filterCatalogRowsByDashboard(
        orderedProducts,
        auditByProductId,
        dashboardFilterForUi,
      ),
    [auditByProductId, dashboardFilterForUi, orderedProducts],
  );

  const tableRows = useMemo(() => {
    if (!data.ok || catalogProductsForTable.length === 0) return [];

    return catalogProductsForTable.map((product, rowIndex) => {
      const pid =
        typeof product.id === "string" && product.id.length > 0
          ? product.id
          : "";
      const rowKey = pid || `row-${rowIndex}`;
      const audit = pid ? auditByProductId[pid] : undefined;
      const displayStatus = product.status
        ? safeDisplayText(product.status).toLowerCase().replace(/_/g, " ")
        : "unknown";

      const auditedScore =
        audit != null ? safeAuditScore(audit) : null;

      const scoreCell =
        audit != null ? (
          <Badge tone={scoreTone(auditedScore)}>
            {String(auditedScore)}
          </Badge>
        ) : (
          <Badge tone="read-only">Not scanned</Badge>
        );

      const issueCount =
        audit != null ? safeIssuesList(audit).length : 0;

      const issuesCell =
        audit != null ? (
          String(issueCount)
        ) : (
          <Text as="span" variant="bodyMd" tone="subdued">
            —
          </Text>
        );

      const topIssueRendered = safeDisplayText(
        audit != null ? audit.topIssue : undefined,
        "",
      );
      const topIssueCell =
        audit != null ? (
          topIssueRendered.trim().length > 0 ? (
            topIssueRendered
          ) : (
            <Text as="span" variant="bodyMd" tone="subdued">
              —
            </Text>
          )
        ) : (
          <Text as="span" variant="bodySm" tone="subdued">
            Run scan
          </Text>
        );

      const productTitle = safeDisplayText(product.title, "Untitled product");

      return [
        <Text key={`t-${rowKey}`} variant="bodyMd" as="span">
          {productTitle}
        </Text>,
        <span key={`sc-${rowKey}`}>{scoreCell}</span>,
        <span key={`ic-${rowKey}`}>{issuesCell}</span>,
        <span key={`ti-${rowKey}`}>{topIssueCell}</span>,
        <Badge key={`st-${rowKey}`} tone={statusTone(product.status)}>
          {displayStatus}
        </Badge>,
        String(
          (Array.isArray(product.tags)
            ? product.tags
            : []
          ).filter((t) => typeof t === "string" && t.trim()).length,
        ),
        (() => {
          const v = product.variantsCount;
          if (typeof v === "number" && Number.isFinite(v)) {
            return String(Math.max(0, Math.trunc(v)));
          }
          if (typeof v === "string" && v.trim() !== "") {
            const n = Number.parseInt(v, 10);
            return Number.isFinite(n) ? String(Math.max(0, n)) : "0";
          }
          return "0";
        })(),
        <Button
          key={`vd-${rowKey}`}
          variant="plain"
          disabled={!pid}
          onClick={() => {
            if (pid) openProductDetails(pid);
          }}
          accessibilityLabel={`View audit details for ${productTitle}`}
        >
          View Details
        </Button>,
      ];
    });
  }, [auditByProductId, catalogProductsForTable, data.ok, openProductDetails]);

  const isListingFieldApplyBusy = useCallback(
    (kind: ApplyListingFieldKind) =>
      trackedApplyField === kind && applyFetcher.state !== "idle",
    [applyFetcher.state, trackedApplyField],
  );

  const scanning = fetcher.state !== "idle";
  const catalogRefreshing = revalidator.state === "loading";
  const catalogNavigating =
    navigation.state === "loading" && navigation.location != null;
  const catalogBusy = catalogRefreshing || catalogNavigating;
  const hasScannedSession = dashboardStats.scannedCount > 0;
  const overviewBusy = scanning || catalogBusy;

  const scannedMetricDisabled =
    !data.ok || dashboardStats.scannedCount === 0;
  const averageMetricDisabled =
    !data.ok ||
    dashboardStats.scannedCount === 0 ||
    dashboardStats.avgScore == null;

  const needsAttentionMetricDisabled =
    !data.ok ||
    dashboardStats.scannedCount === 0 ||
    dashboardStats.needsAttention === 0;

  const commonIssueMetricDisabled =
    !data.ok ||
    dashboardStats.scannedCount === 0 ||
    !topIssueLabel.length ||
    topIssueLabel === DASHBOARD_AGGREGATE_NO_ISSUE_LABEL;

  const dashboardFilterActive = dashboardFilterForUi.mode !== "none";

  const lowestScoreSortingHint =
    dashboardFilterForUi.mode === "lowest_score"
      ? "Showing all catalog products sorted with lowest audit scores first — unscanned products stay at the end."
      : null;

  const activeFilterTone = catalogFilterBadgeTone(dashboardFilterForUi);
  const activeFilterLabel =
    dashboardFilterForUi.mode === "none"
      ? ""
      : catalogFilterBadgeLabel(dashboardFilterForUi);
  const { openFeedback } = useListingFixFeedback();
  const scanHistory = data.scanHistory;
  const activeScanSession = useMemo(
    () => scanHistory.find((session) => session.id === activeScanSessionId) ?? null,
    [activeScanSessionId, scanHistory],
  );

  return (
    <Page
      fullWidth
      compactTitle
      title="ListingFix"
      titleMetadata={<ListingFixBetaBadge />}
      subtitle="Review catalog quality, get recommendations, and apply changes only when you choose."
      secondaryActions={[
        {
          content: "Beta Feedback",
          onAction: openFeedback,
        },
      ]}
      primaryAction={{
        content: "Scan Products",
        onAction: handleScanProducts,
        loading: scanning,
        disabled:
          !data.ok ||
          data.products.length === 0 ||
          scanning ||
          catalogBusy ||
          scanLimitReached,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Box className="listing-fix-page-intro">
              <ListingFixActionReassurance message={REASSURANCE.scan} />
            </Box>

            {!data.ok && catalogLoadError ? (
              <Banner tone="critical" title="Couldn't load products">
                <Text as="p" variant="bodyMd">
                  {catalogLoadError}
                </Text>
              </Banner>
            ) : null}

            {scanLimitReached || scanLimitError ? (
              <Banner tone="warning" title="Daily scan limit reached">
                <Text as="p" variant="bodyMd">
                  {scanLimitError ?? SCAN_LIMIT_MESSAGE}
                </Text>
              </Banner>
            ) : null}

            {scanError ? (
              <Banner tone="critical" title="Scan failed">
                <Text as="p" variant="bodyMd">
                  {scanError}
                </Text>
              </Banner>
            ) : null}

            {data.ok ? (
              <>
                <ListingFixTrustPanel />
                <ListingFixBetaUsageCard usage={data.usage} />
              </>
            ) : null}

            {!data.ok ? null : data.products.length === 0 ? (
              <Card roundedAbove="sm" padding="0">
                <EmptyState
                  image={EMPTY_CATALOG_IMG}
                  heading="No products in this catalog"
                  imageContained
                  fullWidth={false}
                >
                  <Text as="p" variant="bodyMd" alignment="center" tone="subdued">
                    Add products to this development store, then reload this page
                    to see them listed here for audits.
                  </Text>
                </EmptyState>
              </Card>
            ) : (
              <>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm">
                    Overview
                  </Text>
                  <InlineGrid
                    columns={{ xs: 1, sm: 2, md: 2, lg: 4 }}
                    gap="400"
                    alignItems="stretch"
                  >
                    <ListingFixDashboardMetricTile
                      accessibilityHint="Toggle to show audited products only. Press again or use Clear filter to reset."
                      label="Products scanned"
                      selected={dashboardFilterForUi.mode === "scanned"}
                      disabled={scannedMetricDisabled}
                      busy={overviewBusy}
                      onToggle={() =>
                        toggleDashboardCatalogSlice("scanned_products")
                      }
                    >
                      <Text variant="heading2xl" as="p" numeric>
                        {dashboardStats.scannedCount}
                      </Text>
                    </ListingFixDashboardMetricTile>

                    <ListingFixDashboardMetricTile
                      accessibilityHint="Toggle to sort the catalog with the lowest audited scores first. Toggle again or clear to revert."
                      label="Average score"
                      selected={dashboardFilterForUi.mode === "lowest_score"}
                      disabled={averageMetricDisabled}
                      busy={overviewBusy}
                      onToggle={() =>
                        toggleDashboardCatalogSlice("average_scores")
                      }
                    >
                      {dashboardStats.avgScore == null ? (
                        <Text variant="heading2xl" tone="subdued" as="p">
                          —
                        </Text>
                      ) : (
                        <Text variant="heading2xl" as="p" numeric>
                          {dashboardStats.avgScore}
                        </Text>
                      )}
                    </ListingFixDashboardMetricTile>

                    <ListingFixDashboardMetricTile
                      accessibilityHint="Toggle to show scanned products scoring below 80 points."
                      label="Needs attention (score below 80)"
                      selected={dashboardFilterForUi.mode === "needs_attention"}
                      disabled={needsAttentionMetricDisabled}
                      busy={overviewBusy}
                      onToggle={() =>
                        toggleDashboardCatalogSlice("needs_attention")
                      }
                    >
                      <Text variant="heading2xl" as="p" numeric>
                        {dashboardStats.needsAttention}
                      </Text>
                    </ListingFixDashboardMetricTile>

                    <ListingFixDashboardMetricTile
                      accessibilityHint={`Toggle to isolate products flagged with "${topIssueLabel || "common issues"}".`}
                      label="Most common issue"
                      selected={
                        dashboardFilterForUi.mode === "top_issue" &&
                        typeof dashboardFilterForUi.issue === "string" &&
                        dashboardFilterForUi.issue.trim() === topIssueLabel
                      }
                      disabled={commonIssueMetricDisabled}
                      busy={overviewBusy}
                      onToggle={() =>
                        toggleDashboardCatalogSlice(
                          "most_common_issue",
                          topIssueLabel,
                        )
                      }
                    >
                      <Text
                        variant="headingMd"
                        as="p"
                        breakWord
                        fontWeight="semibold"
                      >
                        {safeDisplayText(
                          dashboardStats.topIssue,
                          DASHBOARD_AGGREGATE_NO_ISSUE_LABEL,
                        )}
                      </Text>
                    </ListingFixDashboardMetricTile>
                  </InlineGrid>
                </BlockStack>

                {data.ok ? (
                  <ListingFixScanHistoryPanel
                    sessions={scanHistory}
                    activeSessionId={activeScanSessionId}
                    restoringSessionId={restoringSessionId}
                    onRestore={handleRestoreScan}
                  />
                ) : null}

                {activeScanSession ? (
                  <Banner tone="info" title="Viewing restored scan">
                    <Text as="p" variant="bodyMd">
                      Showing results from{" "}
                      {formatScanSessionLabel(activeScanSession.scanCompletedAt)}.
                      Run Scan Products anytime to refresh with your latest catalog.
                    </Text>
                  </Banner>
                ) : null}

                {!hasScannedSession && !scanning ? (
                  <ListingFixFirstScanPrompt
                    scanning={scanning}
                    disabled={catalogBusy || scanLimitReached}
                    onScan={handleScanProducts}
                  />
                ) : null}

                {scanning ? (
                  <Banner tone="info" title="Scanning products">
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <Spinner
                        accessibilityLabel="Scanning catalog products"
                        size="small"
                      />
                      <Text as="p" variant="bodyMd">
                        Checking listing quality — this usually takes a few seconds.
                      </Text>
                    </InlineStack>
                  </Banner>
                ) : null}

                {catalogBusy && !scanning ? (
                  <Banner tone="info" title="Refreshing catalog">
                    <Text as="p" variant="bodyMd">
                      Syncing the latest product data from Shopify…
                    </Text>
                  </Banner>
                ) : null}

                <Divider />

                <BlockStack gap="200" className="listing-fix-catalog-panel">
                  <Text as="h2" variant="headingSm">
                    Catalog audit
                  </Text>

                  {dashboardFilterActive ? (
                    <InlineStack gap="300" wrap blockAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Active Overview focus:
                      </Text>
                      <Badge tone={activeFilterTone}>{activeFilterLabel}</Badge>
                      <Button
                        variant="plain"
                        accessibilityLabel="Clear Overview catalog focus"
                        onClick={clearDashboardCatalogFilter}
                      >
                        Clear filter
                      </Button>
                    </InlineStack>
                  ) : null}

                  {lowestScoreSortingHint ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {lowestScoreSortingHint}
                    </Text>
                  ) : null}

                  <Card
                    roundedAbove="sm"
                    padding="0"
                    className={
                      scanning ? "listing-fix-catalog-panel--dim" : undefined
                    }
                  >
                    {catalogBusy && catalogProductsForTable.length > 0 ? (
                      <Box padding="600">
                        <BlockStack gap="300">
                          <SkeletonBodyText lines={1} />
                          <SkeletonBodyText lines={8} />
                        </BlockStack>
                      </Box>
                    ) : catalogProductsForTable.length === 0 ? (
                      <Box padding="600">
                        <EmptyState
                          heading={
                            dashboardFilterActive
                              ? "No products match this focus"
                              : hasScannedSession
                                ? "Nothing to show"
                                : FIRST_SCAN_HEADING
                          }
                          fullWidth={false}
                        >
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" alignment="center">
                              {dashboardFilterActive
                                ? "Try clearing the Overview focus or choose a different metric card."
                                : hasScannedSession
                                  ? "Your catalog list is empty — add products in Shopify Admin, then reload."
                                  : FIRST_SCAN_BODY}
                            </Text>
                            {!hasScannedSession && !dashboardFilterActive ? (
                              <Text
                                as="p"
                                variant="bodySm"
                                alignment="center"
                                tone="subdued"
                              >
                                {REASSURANCE.scan}
                              </Text>
                            ) : null}
                            {dashboardFilterActive ? (
                              <InlineStack gap="300" justify="center">
                                <Button onClick={clearDashboardCatalogFilter}>
                                  Clear Overview focus
                                </Button>
                              </InlineStack>
                            ) : !hasScannedSession ? (
                              <InlineStack gap="300" justify="center">
                                <Button
                                  variant="primary"
                                  loading={scanning}
                                  disabled={
                                    scanning ||
                                    catalogBusy ||
                                    scanLimitReached
                                  }
                                  onClick={handleScanProducts}
                                >
                                  Scan Products
                                </Button>
                              </InlineStack>
                            ) : null}
                          </BlockStack>
                        </EmptyState>
                      </Box>
                    ) : (
                      <Box maxWidth="100%" overflowX="auto">
                        <DataTable
                          columnContentTypes={[
                            "text",
                            "text",
                            "numeric",
                            "text",
                            "text",
                            "numeric",
                            "numeric",
                            "text",
                          ]}
                          headings={[
                            "Product",
                            "Score",
                            "Issues",
                            "Top issue",
                            "Status",
                            "Tags",
                            "Variants",
                            "Actions",
                          ]}
                          rows={tableRows}
                          hoverable={false}
                        />
                      </Box>
                    )}
                  </Card>
                </BlockStack>
              </>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={closeProductDetails}
        title="Listing audit details"
        size="large"
        limitHeight
        primaryAction={{
          content: "Close",
          onAction: closeProductDetails,
        }}
      >
        <Modal.Section>
          {!detailProduct ? null : detailAudit ? (
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Product title
                </Text>
                <Text as="h2" variant="headingLg">
                  {safeDisplayText(detailProduct.title, "Untitled product")}
                </Text>
                <InlineScoreRow audit={detailAudit} />
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Issues detected
                </Text>
                {safeIssuesList(detailAudit).length ? (
                  <List type="bullet" gap="loose">
                    {safeIssuesList(detailAudit).map((issue, idx) => (
                      <List.Item key={`${detailProduct.id}-issue-${idx}`}>
                        {safeDisplayText(issue, "—")}
                      </List.Item>
                    ))}
                  </List>
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No issues detected for this product — strong listing hygiene.
                  </Text>
                )}
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  What to fix first
                </Text>
                {Array.isArray(detailAudit.recommendations) &&
                detailAudit.recommendations.length ? (
                  <BlockStack gap="300">
                    {detailAudit.recommendations.map((rec, recIdx) => {
                      const issueLine = safeDisplayText(rec?.issue, "Issue");
                      const recLine = safeDisplayText(
                        rec?.recommendation,
                        "",
                      );
                      return (
                      <Card key={`${detailProduct.id}-rec-${recIdx}`}>
                        <BlockStack gap="150">
                          <Text as="h4" variant="headingSm">
                            {issueLine}
                          </Text>
                          <Text as="p" variant="bodyMd">
                            {recLine}
                          </Text>
                        </BlockStack>
                      </Card>
                      );
                    })}
                  </BlockStack>
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No corrective actions suggested — listing looks balanced for the
                    current rules.
                  </Text>
                )}
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    AI Listing Improvements
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    AI-generated ideas for review only. Shopify updates occur only when
                    you click <strong>Apply to Shopify</strong> beside a suggestion — nothing
                    syncs automatically and there is no bulk apply.
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {AI_DISCLOSURE}
                  </Text>
                  <InlineStack gap="200" wrap blockAlign="center">
                    <Badge tone={aiLimitReached ? "critical" : "info"}>
                      {`AI generations remaining today: ${data.usage.aiRemaining}`}
                    </Badge>
                  </InlineStack>
                </BlockStack>

                {aiLimitReached || aiLimitError ? (
                  <Banner tone="warning" title="Daily AI generation limit reached">
                    <Text as="p" variant="bodyMd">
                      {aiLimitError ?? AI_LIMIT_MESSAGE}
                    </Text>
                  </Banner>
                ) : null}

                <InlineStack gap="300" wrap blockAlign="center">
                  <Button
                    variant="primary"
                    loading={aiGenerating}
                    disabled={
                      aiGenerating ||
                      applyInFlight ||
                      !detailProduct ||
                      aiLimitReached
                    }
                    onClick={handleGenerateAiSuggestions}
                  >
                    Generate AI Fixes
                  </Button>
                </InlineStack>
                <ListingFixActionReassurance message={REASSURANCE.ai} />

                {aiErrorMessage ? (
                  <Banner tone="critical" title="Couldn't generate AI suggestions">
                    <Text as="p" variant="bodyMd">
                      {aiErrorMessage}
                    </Text>
                  </Banner>
                ) : null}

                {applyOutcomeBanner ? (
                  <Banner
                    tone={
                      applyOutcomeBanner.tone === "success"
                        ? "success"
                        : "critical"
                    }
                    title={applyOutcomeBanner.title}
                    onDismiss={() => setApplyOutcomeBanner(null)}
                  >
                    <Text as="p" variant="bodyMd">
                      {applyOutcomeBanner.detail}
                    </Text>
                  </Banner>
                ) : null}

                {aiGenerating ? (
                  <InlineStack gap="200" wrap blockAlign="center">
                    <Spinner
                      accessibilityLabel="Generating AI listing suggestions"
                      size="small"
                    />
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Working on refreshed copy tailored to your audit hints…
                    </Text>
                  </InlineStack>
                ) : null}

                {!aiErrorMessage &&
                !aiLimitError &&
                !aiGenerating &&
                !aiSuggestions ? (
                  <Banner tone="info" title="Review before you apply">
                    <Text as="p" variant="bodyMd">
                      Generate recommendations for title, description, tags, and SEO
                      based on this product&apos;s audit. Edit anything you like before
                      applying a single field to Shopify.
                    </Text>
                  </Banner>
                ) : null}

                {aiSuggestions ? (
                  <div
                    ref={aiResultsAnchorRef}
                    tabIndex={-1}
                    role="region"
                    aria-label="AI-generated suggestion details"
                    style={{
                      scrollMarginTop: "0.875rem",
                      scrollMarginBottom: "0.5rem",
                      borderRadius: "var(--p-border-radius-300)",
                      outline: highlightFreshAiSuggestions
                        ? "3px solid var(--p-color-border-focus)"
                        : "3px solid transparent",
                      outlineOffset: "3px",
                      transition:
                        "outline 260ms ease, outline-offset 260ms ease",
                    }}
                  >
                    <BlockStack gap="400">
                    <AiSuggestionPreviewBlock
                      heading="Overview"
                      value={aiSuggestions.summary}
                      bodyVariant="paragraph"
                    />

                    <AiSuggestionPreviewBlock
                      heading="Suggested title"
                      value={aiSuggestions.improvedTitle}
                      bodyVariant="paragraph"
                      applyBusy={isListingFieldApplyBusy("title")}
                      applySuccessPulse={applySuccessBadgeField === "title"}
                      disableApply={
                        aiSuggestions.improvedTitle.trim().length === 0 ||
                        applyInFlight
                      }
                      onApplyToShopify={() =>
                        beginListingFieldApply("title", () => {
                          const fd = new FormData();
                          fd.set("value", aiSuggestions.improvedTitle);
                          return fd;
                        })
                      }
                    />

                    <AiSuggestionPreviewBlock
                      heading="Suggested description"
                      value={aiSuggestions.improvedDescription}
                      bodyVariant="preformatted"
                      applyBusy={isListingFieldApplyBusy("description")}
                      applySuccessPulse={applySuccessBadgeField === "description"}
                      disableApply={
                        aiSuggestions.improvedDescription.trim().length === 0 ||
                        applyInFlight
                      }
                      onApplyToShopify={() =>
                        beginListingFieldApply("description", () => {
                          const fd = new FormData();
                          fd.set("value", aiSuggestions.improvedDescription);
                          return fd;
                        })
                      }
                    />

                    <AiSuggestionPreviewBlock
                      heading="SEO meta description"
                      value={aiSuggestions.seoDescription}
                      bodyVariant="paragraph"
                      footnote={
                        <>
                          Targets the search listing description shown in Shopify
                          admin (product SEO description). Existing SEO titles are
                          preserved when possible.
                        </>
                      }
                      applyBusy={isListingFieldApplyBusy("seo")}
                      applySuccessPulse={applySuccessBadgeField === "seo"}
                      disableApply={
                        aiSuggestions.seoDescription.trim().length === 0 ||
                        applyInFlight
                      }
                      onApplyToShopify={() =>
                        beginListingFieldApply("seo", () => {
                          const fd = new FormData();
                          fd.set("value", aiSuggestions.seoDescription);
                          return fd;
                        })
                      }
                    />

                    <BlockStack gap="200">
                      <InlineStack
                        align="space-between"
                        blockAlign="start"
                        gap="300"
                        wrap
                      >
                        <BlockStack gap="050">
                          <InlineStack gap="200" wrap blockAlign="center">
                            <Text variant="headingSm" as="h4">
                              Suggested tags
                            </Text>
                            {applySuccessBadgeField === "tags" ? (
                              <Badge tone="success">Synced</Badge>
                            ) : null}
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Applying replaces every tag currently on this product —
                            preview in Shopify afterward if unsure.
                          </Text>
                        </BlockStack>

                        <InlineStack gap="200" wrap blockAlign="center">
                          <Button
                            variant="primary"
                            size="slim"
                            loading={isListingFieldApplyBusy("tags")}
                            disabled={
                              aiSuggestions.suggestedTags.length === 0 ||
                              applyInFlight
                            }
                            onClick={() =>
                              beginListingFieldApply("tags", () => {
                                const fd = new FormData();
                                fd.set(
                                  "tagsJson",
                                  JSON.stringify(aiSuggestions.suggestedTags),
                                );
                                return fd;
                              })
                            }
                          >
                            Apply to Shopify
                          </Button>
                          <Button
                            variant="secondary"
                            size="slim"
                            disabled={
                              aiSuggestions.suggestedTags.length === 0
                            }
                            onClick={() =>
                              void navigator.clipboard.writeText(
                                aiSuggestions.suggestedTags.join(", "),
                              )
                            }
                          >
                            Copy all
                          </Button>
                        </InlineStack>
                      </InlineStack>
                      <ListingFixActionReassurance message={REASSURANCE.apply} />

                      {aiSuggestions.suggestedTags.length === 0 ? (
                        <Text as="p" variant="bodyMd" tone="subdued">
                          No alternate tags surfaced — reuse your existing tagging
                          approach.
                        </Text>
                      ) : (
                        <InlineStack gap="150" wrap>
                          {aiSuggestions.suggestedTags.map((tag, index) => (
                            <Badge key={`${tag}-${index}`}>{tag}</Badge>
                          ))}
                        </InlineStack>
                      )}
                    </BlockStack>
                  </BlockStack>
                  </div>
                ) : null}
              </BlockStack>
            </BlockStack>
          ) : (
            <Banner tone="info" title="Scan this product first">
              <Text as="p" variant="bodyMd">
                Run <strong>Scan Products</strong> on your catalog to see scores,
                recommendations, and optional AI copy for this listing. Your Shopify
                catalog stays unchanged until you choose to apply a field.
              </Text>
            </Banner>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function AiSuggestionPreviewBlock({
  heading,
  value,
  bodyVariant,
  applyBusy,
  disableApply,
  applySuccessPulse,
  onApplyToShopify,
  footnote,
}: {
  heading: string;
  value: string;
  bodyVariant: "paragraph" | "preformatted";
  applyBusy?: boolean;
  disableApply?: boolean;
  applySuccessPulse?: boolean;
  onApplyToShopify?: () => void;
  footnote?: ReactNode;
}) {
  const canApply = typeof onApplyToShopify === "function";

  const copyDisabled = value.trim().length === 0;

  return (
    <BlockStack gap="100">
      <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
        <BlockStack gap="050">
          <InlineStack gap="200" wrap blockAlign="center">
            <Text variant="headingSm" as="h4">
              {heading}
            </Text>
            {applySuccessPulse ? (
              <Badge tone="success">Synced</Badge>
            ) : null}
          </InlineStack>
          {footnote ? (
            <Box maxWidth="620px">
              <Text as="p" variant="bodySm" tone="subdued">
                {footnote}
              </Text>
            </Box>
          ) : null}
        </BlockStack>
        <InlineStack gap="200" wrap blockAlign="center">
          {canApply ? (
            <Button
              size="slim"
              variant="primary"
              loading={applyBusy}
              disabled={Boolean(disableApply || applyBusy)}
              onClick={() => onApplyToShopify?.()}
            >
              Apply to Shopify
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="slim"
            disabled={copyDisabled}
            onClick={() =>
              void navigator.clipboard.writeText(value).catch(() => {
                // Clipboard may be unavailable inside some embedded frames.
              })
            }
          >
            Copy
          </Button>
        </InlineStack>
      </InlineStack>
      {canApply ? (
        <ListingFixActionReassurance message={REASSURANCE.apply} />
      ) : null}
      <Card padding="400">
        {bodyVariant === "preformatted" ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily:
                '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
              fontSize: "0.9375rem",
              lineHeight: 1.4,
            }}
          >
            {value}
          </pre>
        ) : (
          <Text as="p" variant="bodyMd" breakWord>
            {value}
          </Text>
        )}
      </Card>
    </BlockStack>
  );
}

function InlineScoreRow({ audit }: { audit: StoredProductAudit }) {
  const s = safeAuditScore(audit);
  return (
    <BlockStack gap="100">
      <Text variant="bodyMd" as="p" tone="subdued">
        Current audit score
      </Text>
      <Badge tone={scoreTone(s)} size="large">
        {s}/100
      </Badge>
    </BlockStack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
