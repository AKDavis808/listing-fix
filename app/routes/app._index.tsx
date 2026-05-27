import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import type { ReactNode } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
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
  Spinner,
  Text,
} from "@shopify/polaris";
import type { BadgeProps } from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  auditProduct,
  type ProductAuditOutcome,
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
type AuditedCatalogProductRow = ClientCatalogProductRow &
  ProductAuditOutcome & {
    recommendations: IssueRecommendationPair[];
  };

type LoaderFailure = {
  ok: false;
  errorMessage: string;
  products: [];
};

type LoaderSuccess = {
  ok: true;
  errorMessage: null;
  products: ClientCatalogProductRow[];
};

export type ListingFixHomeLoaderData = LoaderFailure | LoaderSuccess;

type AuditActionFail = { ok: false; errorMessage: string };

type AuditActionSuccess = {
  ok: true;
  audited: AuditedCatalogProductRow[];
};

export type ListingFixAuditActionData =
  | AuditActionFail
  | AuditActionSuccess
  | null;

type StoredProductAudit = ProductAuditOutcome & {
  recommendations: IssueRecommendationPair[];
};

/** Safest string for Polaris `Text`/`Badge`/`label` children (avoids invalid React children). */
function safeDisplayText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<ListingFixHomeLoaderData> => {
  const { admin } = await authenticate.admin(request);

  const result = await fetchCatalogProducts(admin, 25);
  if (!result.ok) {
    return {
      ok: false,
      errorMessage: result.errorMessage,
      products: [],
    };
  }

  return {
    ok: true,
    errorMessage: null,
    products: result.products.map(toClientCatalogRow),
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ListingFixAuditActionData> => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") !== "audit") {
    return null;
  }

  const result = await fetchCatalogProducts(admin, 25);
  if (!result.ok) {
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

  return { ok: true, audited };
};

/** Safe Polaris tone for product status badges (handles missing/non-string GraphQL payloads). */
function statusTone(status: string | null | undefined): BadgeProps["tone"] | undefined {
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

function scoreTone(score: number): Exclude<BadgeProps["tone"], undefined> {
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "critical";
}

/** In-memory sort: scanned rows first (worst score first); unscanned preserves catalog order. */
/** Safe numeric audit score for sorting/filtering when state is incomplete. */
function safeAuditScore(audit: StoredProductAudit | undefined | null): number {
  if (
    audit == null ||
    typeof audit.score !== "number" ||
    !Number.isFinite(audit.score)
  ) {
    return 0;
  }
  return audit.score;
}

function coerceStoredAuditFromRow(row: AuditedCatalogProductRow): StoredProductAudit {
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

/** Issue list stored on audits (arrays only; tolerant of malformed responses). */
function safeIssuesList(audit: StoredProductAudit | undefined | null): string[] {
  return Array.isArray(audit?.issues)
    ? audit.issues.filter((i): i is string => typeof i === "string")
    : [];
}

function sortProductsForTable(
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

const DASHBOARD_AGGREGATE_NO_ISSUE_LABEL = "No issues detected";

export type DashboardCatalogFilter =
  | { mode: "none" }
  | { mode: "scanned" }
  | { mode: "lowest_score" }
  | { mode: "needs_attention" }
  | { mode: "top_issue"; issue: string };

/** Coerce filter for render — invalid state becomes `none` (prevents pill/table crash). */
function normalizeDashboardFilter(filter: DashboardCatalogFilter): DashboardCatalogFilter {
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

function catalogFilterBadgeTone(
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

function catalogFilterBadgeLabel(filter: DashboardCatalogFilter): string {
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
      filter satisfies never;
      return "";
  }
}

/** Rows for the catalog table preserving `orderedProducts` order within the slice. */
function filterCatalogRowsByDashboard(
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

function DashboardInteractiveMetricTile({
  accessibilityHint,
  label,
  selected,
  disabled,
  onToggle,
  children,
}: {
  accessibilityHint: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="listing-fix-overview-metric"
      aria-pressed={selected}
      aria-disabled={disabled ?? false}
      aria-label={accessibilityHint}
      disabled={disabled}
      onClick={onToggle}
    >
      <div className="listing-fix-overview-metric-inner">
        <Card padding="400" roundedAbove="sm">
          <BlockStack gap="150">
            <Box minHeight="1.75rem">{children}</Box>
            <Text variant="bodySm" tone="subdued" as="p">
              {label}
            </Text>
          </BlockStack>
        </Card>
      </div>
    </button>
  );
}

function computeDashboardStats(
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

const EMPTY_CATALOG_IMG =
  "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

export default function ListingFixHomePage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ListingFixAuditActionData>();
  const aiFetcher = useFetcher<AiSuggestionsActionData>();
  const applyFetcher = useFetcher<ApplyListingFieldActionData>();

  const shopify = useAppBridge();
  const revalidator = useRevalidator();

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

  useEffect(() => {
    setAuditByProductId({});
    setDashboardFilter({ mode: "none" });
  }, [fingerprint]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (!fetcher.data.ok) return;

    const next: Record<string, StoredProductAudit> = {};
    for (const row of fetcher.data.audited) {
      if (!row?.id || typeof row.id !== "string") continue;
      next[row.id] = coerceStoredAuditFromRow(row);
    }
    setAuditByProductId(next);
  }, [fetcher.state, fetcher.data]);

  const handleScanProducts = useCallback(() => {
    const form = new FormData();
    form.set("intent", "audit");
    fetcher.submit(form, { method: "post" });
  }, [fetcher]);

  const openProductDetails = useCallback((id: string) => {
    setDetailProductId(id);
  }, []);

  const closeProductDetails = useCallback(() => setDetailProductId(null), []);

  const scanError =
    fetcher.state === "idle" && fetcher.data && !fetcher.data.ok
      ? fetcher.data.errorMessage
      : null;

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
  const aiErrorMessage = aiFailure ? aiIdleData.error : null;

  const handleGenerateAiSuggestions = useCallback(() => {
    if (!detailProductId || !detailAudit) return;

    setHighlightFreshAiSuggestions(false);
    if (aiHighlightDismissTimerRef.current != null) {
      window.clearTimeout(aiHighlightDismissTimerRef.current);
      aiHighlightDismissTimerRef.current = null;
    }

    aiSuggestionRoundRef.current += 1;
    const requestToken = `lf_ai_${detailProductId}_${aiSuggestionRoundRef.current}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

    const form = new FormData();
    form.set("intent", "ai-suggestions");
    form.set("productId", detailProductId);
    form.set("requestToken", requestToken);

    aiFetcher.submit(form, {
      method: "post",
      action: "/app/ai-suggestions",
    });
  }, [aiFetcher, detailAudit, detailProductId]);

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
      const detail = userErrText
        ? `${response.errorMessage} ${userErrText}`
        : response.errorMessage;
      shopify.toast.show(response.errorMessage, { isError: true });
      setApplyOutcomeBanner({
        tone: "critical",
        title: `${APPLY_FIELD_LABELS[response.field]} not saved`,
        detail,
      });
    }
  }, [
    applyFetcher.data,
    applyFetcher.state,
    detailProductId,
    revalidator,
    shopify,
    trackedApplyField,
  ]);

  const beginListingFieldApply = useCallback(
    (field: ApplyListingFieldKind, buildPayload: () => FormData | null) => {
      if (!detailProductId) return;
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
      applyFetcher.submit(form, {
        method: "post",
        action: "/app/apply-listing-field",
      });
    },
    [applyFetcher, detailProductId],
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
    setDashboardFilter({ mode: "none" });
  }, []);

  const toggleDashboardCatalogSlice = useCallback(
    (
      slot:
        | "scanned_products"
        | "average_scores"
        | "needs_attention"
        | "most_common_issue",
      issueSeed?: string,
    ) => {
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
    },
    [],
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

  const scanning = fetcher.state === "submitting";

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
  return (
    <Page
      fullWidth
      compactTitle
      title="ListingFix"
      subtitle="Listing quality audits for your first 25 catalog products."
      primaryAction={{
        content: "Scan Products",
        onAction: handleScanProducts,
        loading: scanning,
        disabled: !data.ok || data.products.length === 0,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {!data.ok && (
              <Banner tone="critical" title="Couldn't load products">
                <Text as="p" variant="bodyMd">
                  {data.errorMessage}
                </Text>
              </Banner>
            )}

            {scanError ? (
              <Banner tone="critical" title="Scan failed">
                <Text as="p" variant="bodyMd">
                  {scanError}
                </Text>
              </Banner>
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
                    <DashboardInteractiveMetricTile
                      accessibilityHint="Toggle to show audited products only. Press again or use Clear filter to reset."
                      label="Products scanned"
                      selected={dashboardFilterForUi.mode === "scanned"}
                      disabled={scannedMetricDisabled}
                      onToggle={() =>
                        toggleDashboardCatalogSlice("scanned_products")
                      }
                    >
                      <Text variant="heading2xl" as="p" numeric>
                        {dashboardStats.scannedCount}
                      </Text>
                    </DashboardInteractiveMetricTile>

                    <DashboardInteractiveMetricTile
                      accessibilityHint="Toggle to sort the catalog with the lowest audited scores first. Toggle again or clear to revert."
                      label="Average score"
                      selected={dashboardFilterForUi.mode === "lowest_score"}
                      disabled={averageMetricDisabled}
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
                    </DashboardInteractiveMetricTile>

                    <DashboardInteractiveMetricTile
                      accessibilityHint="Toggle to show scanned products scoring below 80 points."
                      label="Needs attention (score below 80)"
                      selected={dashboardFilterForUi.mode === "needs_attention"}
                      disabled={needsAttentionMetricDisabled}
                      onToggle={() =>
                        toggleDashboardCatalogSlice("needs_attention")
                      }
                    >
                      <Text variant="heading2xl" as="p" numeric>
                        {dashboardStats.needsAttention}
                      </Text>
                    </DashboardInteractiveMetricTile>

                    <DashboardInteractiveMetricTile
                      accessibilityHint={`Toggle to isolate products flagged with "${topIssueLabel || "common issues"}".`}
                      label="Most common issue"
                      selected={
                        dashboardFilterForUi.mode === "top_issue" &&
                        typeof dashboardFilterForUi.issue === "string" &&
                        dashboardFilterForUi.issue.trim() === topIssueLabel
                      }
                      disabled={commonIssueMetricDisabled}
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
                    </DashboardInteractiveMetricTile>
                  </InlineGrid>
                </BlockStack>

                <Divider />

                <BlockStack gap="200">
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

                  <Card roundedAbove="sm" padding="0">
                    {catalogProductsForTable.length === 0 ? (
                      <Box padding="600">
                        <EmptyState
                          heading="Nothing matches right now"
                          fullWidth={false}
                        >
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" alignment="center">
                              {dashboardFilterActive
                                ? "Try widening your Overview focus — or scan more products."
                                : "There are no products to show yet."}
                            </Text>
                            {dashboardFilterActive ? (
                              <InlineStack gap="300" justify="center">
                                <Button onClick={clearDashboardCatalogFilter}>
                                  Clear Overview focus
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
                </BlockStack>

                <InlineStack gap="300" wrap>
                  <Button
                    variant="primary"
                    loading={aiGenerating}
                    disabled={aiGenerating || !detailProduct}
                    onClick={handleGenerateAiSuggestions}
                  >
                    Generate AI Fixes
                  </Button>
                </InlineStack>

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
                        applyFetcher.state !== "idle"
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
                        applyFetcher.state !== "idle"
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
                        applyFetcher.state !== "idle"
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
                              applyFetcher.state !== "idle"
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
            <Banner tone="info" title="Run a listing scan">
              <Text as="p" variant="bodyMd">
                Use <strong>Scan Products</strong> to analyze this catalog. You can
                then reopen details to see scores, issues, and step-by-step fix ideas
                — nothing here changes your Shopify data.
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
