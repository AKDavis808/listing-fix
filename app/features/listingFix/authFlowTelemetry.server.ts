import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { logListingFixEvent } from "./telemetry";

const AUTH_FLOW_COOKIE = "listingfix_auth_flow_id";
const DEDUPE_MS = 30_000;
const FLOW_TTL_MS = 15 * 60_000;

type AuthFlowStep = {
  event: string;
  at: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

type AuthFlowState = {
  flowId: string;
  shop: string | null;
  startedAt: string;
  steps: AuthFlowStep[];
  outcome: "in_progress" | "success" | "failure";
  lastRoute: string | null;
  lastFailure: string | null;
};

const recentEventKeys = new Map<string, number>();
const activeFlows = new Map<string, AuthFlowState>();
const summarizedFlowIds = new Set<string>();

const TERMINAL_EVENTS = new Set([
  "auth_flow_success",
  "auth_flow_failure",
  "app_enter_200",
  "oauth_callback_validation_failure",
  "prisma_storeSession_failure",
  "shopify_auth_callback_failure",
]);

export function getAuthFlowCookieName(): string {
  return AUTH_FLOW_COOKIE;
}

export function readAuthFlowId(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("authFlowId");
  if (fromQuery) return fromQuery;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${AUTH_FLOW_COOKIE}=([^;]+)`),
  );
  return match?.[1]?.trim() ?? null;
}

export function buildAuthFlowCookie(flowId: string): string {
  const maxAge = Math.floor(FLOW_TTL_MS / 1000);
  return `${AUTH_FLOW_COOKIE}=${flowId}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure; HttpOnly`;
}

export function appendAuthFlowIdToUrl(url: string, flowId: string): string {
  const parsed = new URL(url, "https://placeholder.local");
  parsed.searchParams.set("authFlowId", flowId);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function getOrCreateAuthFlowId(request: Request): string {
  const existing = readAuthFlowId(request);
  if (existing) return existing;
  return randomUUID();
}

function shouldDedupeAuthFlowEvent(key: string): boolean {
  const now = Date.now();
  const last = recentEventKeys.get(key) ?? 0;
  if (now - last < DEDUPE_MS) return true;
  recentEventKeys.set(key, now);
  return false;
}

function getFlowState(flowId: string, shop: string | null): AuthFlowState {
  const existing = activeFlows.get(flowId);
  if (existing) return existing;

  const created: AuthFlowState = {
    flowId,
    shop,
    startedAt: new Date().toISOString(),
    steps: [],
    outcome: "in_progress",
    lastRoute: null,
    lastFailure: null,
  };
  activeFlows.set(flowId, created);
  return created;
}

function writeLastFlowSnapshot(state: AuthFlowState): void {
  try {
    const dir = join(process.cwd(), ".auth-debug");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "last-flow.json"),
      JSON.stringify(state, null, 2),
      "utf8",
    );
  } catch {
    // Best-effort debug artifact.
  }
}

function inferLikelyRootCause(state: AuthFlowState): string {
  const events = state.steps.map((step) => step.event);
  const last = events.at(-1) ?? "unknown";

  if (events.includes("oauth_callback_validation_failure")) {
    const preValidationStep = state.steps.find(
      (step) => step.event === "oauth_callback_pre_validation",
    );
    if (preValidationStep?.meta?.callback_hmac_valid === false) {
      return "OAuth callback HMAC validation failed — SHOPIFY_API_SECRET on Railway likely does not match Shopify Dev Dashboard Client secret.";
    }
    if (preValidationStep?.meta?.callback_state_matches_cookie === false) {
      return "OAuth callback state query does not match verified state cookie.";
    }
    if (preValidationStep?.meta?.duplicate_state_cookie_detected === true) {
      return "Duplicate shopify_app_state cookies detected on callback.";
    }
    if (preValidationStep?.meta?.redirect_uri_matches_expected === false) {
      return "Configured redirect URI does not match https://listing-fix-production.up.railway.app/auth/callback.";
    }
    if (
      preValidationStep?.meta?.configured_api_key_matches_toml_client_id ===
      false
    ) {
      return "SHOPIFY_API_KEY does not match shopify.app.toml client_id.";
    }
    return "OAuth callback validation failed — inspect oauth_callback_pre_validation logs for HMAC, state, and redirect URI.";
  }
  if (events.includes("prisma_storeSession_failure")) {
    return "Prisma session write failed after OAuth — check DATABASE_URL and Session schema.";
  }
  if (
    events.includes("oauth_top_level_set_cookie_count") &&
    state.steps.some(
      (step) =>
        step.event === "oauth_callback_entered" &&
        step.meta?.cookieHeaderPresent === false,
    )
  ) {
    return "OAuth cookies were set but not returned on callback — likely iframe/top-level cookie scope issue.";
  }
  if (events.includes("redirect_to_oauth") && !events.includes("oauth_top_level_auth_begin")) {
    return "Redirected to OAuth but top-level auth.begin never ran — check /auth/top-level escape flow.";
  }
  if (last === "app_enter" && state.outcome !== "success") {
    return "App loader did not complete with session — offline token missing or authenticate.admin failed.";
  }

  return `Auth flow stopped at '${last}' — inspect steps in auth-debug-report.md.`;
}

function inferNextAction(state: AuthFlowState): string {
  const cause = inferLikelyRootCause(state);
  if (cause.includes("HMAC validation failed")) {
    return "Copy Client secret from Shopify Dev Dashboard into Railway SHOPIFY_API_SECRET exactly, redeploy, then retry OAuth.";
  }
  if (cause.includes("Duplicate shopify_app_state")) {
    return "Clear cookies for listing-fix-production.up.railway.app and retry OAuth once.";
  }
  if (cause.includes("redirect URI")) {
    return "Set SHOPIFY_APP_URL=https://listing-fix-production.up.railway.app and confirm Partner redirect URLs.";
  }
  if (cause.includes("SHOPIFY_API_KEY")) {
    return "Set Railway SHOPIFY_API_KEY to shopify.app.toml client_id and redeploy.";
  }
  if (cause.includes("cookie")) {
    return "Run npm run auth:e2e and confirm /auth?embedded=0 returns Set-Cookie before callback.";
  }
  if (cause.includes("Prisma")) {
    return "Run npm run auth:doctor and fix DATABASE_URL / migrate deploy.";
  }
  if (cause.includes("top-level")) {
    return "Open /auth/top-level in embedded context and verify _top navigation to /auth?embedded=0.";
  }
  return "Run npm run auth:doctor, then npm run auth:e2e, and review .auth-debug/last-flow.json.";
}

export function logAuthFlowSummary(state: AuthFlowState): void {
  if (summarizedFlowIds.has(state.flowId)) return;
  summarizedFlowIds.add(state.flowId);

  const stepEvents = state.steps.map((step) => step.event);
  logListingFixEvent({
    action: state.outcome === "success" ? "oauth_complete" : "session_missing",
    shop: state.shop,
    meta: {
      event: "auth_flow_summary",
      flowId: state.flowId,
      outcome: state.outcome,
      stepCount: state.steps.length,
      steps: stepEvents.join(" → "),
      lastRoute: state.lastRoute,
      lastFailure: state.lastFailure,
      likelyRootCause: inferLikelyRootCause(state),
      nextAction: inferNextAction(state),
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
    },
  });

  writeLastFlowSnapshot(state);
  activeFlows.delete(state.flowId);
}

export function recordAuthFlowStep(
  request: Request | null,
  event: string,
  meta?: Record<string, string | number | boolean | null | undefined>,
): string | null {
  if (!request) return null;

  const flowId = getOrCreateAuthFlowId(request);
  const shop =
    (typeof meta?.shop === "string" ? meta.shop : null) ??
    new URL(request.url).searchParams.get("shop");

  const dedupeKey = `${flowId}:${event}:${meta?.route ?? ""}:${meta?.pathname ?? ""}`;
  if (shouldDedupeAuthFlowEvent(dedupeKey)) {
    return flowId;
  }

  const state = getFlowState(flowId, shop);
  state.shop = shop ?? state.shop;
  state.lastRoute =
    (typeof meta?.pathname === "string" ? meta.pathname : null) ??
    new URL(request.url).pathname;

  state.steps.push({
    event,
    at: new Date().toISOString(),
    meta,
  });

  if (event.includes("failure") || event.includes("_failure")) {
    state.outcome = "failure";
    state.lastFailure =
      typeof meta?.message === "string"
        ? meta.message
        : typeof meta?.failureType === "string"
          ? meta.failureType
          : event;
  }

  if (event === "app_enter_200" || event === "auth_flow_success") {
    state.outcome = "success";
  }

  const action = event.includes("failure")
    ? "session_missing"
    : event.includes("redirect")
      ? "auth_redirect"
      : event.includes("app_enter") || event === "auth_flow_success"
        ? "session_restored"
        : event.includes("callback_validation_success") ||
            event.includes("prisma_session_saved")
          ? "oauth_complete"
          : "oauth_start";

  logListingFixEvent({
    action,
    shop: state.shop,
    meta: {
      event,
      flowId,
      ...meta,
    },
  });

  writeLastFlowSnapshot(state);

  if (TERMINAL_EVENTS.has(event) || state.steps.length >= 24) {
    logAuthFlowSummary(state);
  }

  return flowId;
}

export function markAuthFlowSuccess(request: Request): void {
  recordAuthFlowStep(request, "app_enter_200", {
    pathname: new URL(request.url).pathname,
  });
}
