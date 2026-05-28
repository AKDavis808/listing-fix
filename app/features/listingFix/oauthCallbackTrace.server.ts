import {
  CookieNotFound,
  InvalidHmacError,
  InvalidOAuthError,
  ShopifyError,
} from "@shopify/shopify-api";
import type { Session } from "@shopify/shopify-api";

import {
  getOAuthBeginCookieSnapshot,
  clearOAuthBeginCookieSnapshot,
} from "./oauthBeginCookieSnapshot.server";
import {
  classifyOAuthCallbackError,
  logOAuthCallbackValidationFailure,
} from "./oauthCallbackDiagnostics.server";
import { STATE_COOKIE_NAME } from "./oauthCookiePolicy.server";
import { recordAuthFlowStep } from "./authFlowTelemetry.server";
import {
  logAfterAuthPhase,
  logAuthCallbackCompleted,
  logOAuthCallbackError,
} from "./oauthSessionDiagnostics.server";
import { logListingFixEvent, sanitizeErrorMessage } from "./telemetry";

function getCookieNames(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];

  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter(Boolean);
}

function extractErrorStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  return error.stack.slice(0, 2000);
}

export function formatOAuthCallbackErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return sanitizeErrorMessage(error) || "Unknown OAuth callback error";
}

export function oauthCallbackHttpStatus(error: unknown): number {
  if (
    error instanceof CookieNotFound ||
    error instanceof InvalidOAuthError ||
    error instanceof InvalidHmacError
  ) {
    return 400;
  }

  if (error instanceof ShopifyError) {
    return 400;
  }

  return 500;
}

export function logOAuthCallbackPhase(
  phase: string,
  shop: string | null,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  logListingFixEvent({
    action: phase.includes("failure") ? "session_missing" : "oauth_start",
    shop,
    meta: {
      event: phase,
      ...meta,
    },
  });
}

export function logOAuthCallbackRequestContext(request: Request): void {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const cookieHeader = request.headers.get("cookie");
  const cookieNames = getCookieNames(cookieHeader);

  logOAuthCallbackPhase("oauth_callback_entered", shop, {
    route: "auth.callback",
    pathname: url.pathname,
    oauth_callback_shop_present: Boolean(shop),
    oauth_callback_code_present: Boolean(url.searchParams.get("code")),
    oauth_callback_state_present: Boolean(url.searchParams.get("state")),
    oauth_callback_hmac_present: Boolean(url.searchParams.get("hmac")),
    oauth_callback_timestamp_present: Boolean(url.searchParams.get("timestamp")),
    cookieHeaderPresent: Boolean(cookieHeader),
    oauth_callback_cookie_header_present: Boolean(cookieHeader),
    callback_cookie_names: cookieNames.join(","),
    stateCookiePresent: cookieNames.includes(STATE_COOKIE_NAME),
  });

  recordAuthFlowStep(request, "oauth_callback_entered", {
    shop,
    pathname: url.pathname,
    cookieHeaderPresent: Boolean(cookieHeader),
    stateCookiePresent: cookieNames.includes(STATE_COOKIE_NAME),
    oauth_callback_cookie_header_present: Boolean(cookieHeader),
  });
}

export function logOAuthCallbackCookieDiagnostics(
  request: Request,
  shop: string | null,
  error: unknown,
): void {
  const cookieHeader = request.headers.get("cookie");
  const cookieNames = getCookieNames(cookieHeader);
  const beginSnapshot = getOAuthBeginCookieSnapshot(shop);

  logListingFixEvent({
    action: "session_missing",
    shop,
    message: error,
    meta: {
      event: "oauth_callback_cookie_diagnostics",
      failureType: classifyOAuthCallbackError(error),
      callbackCookieHeader: cookieHeader ?? null,
      callback_cookie_names: cookieNames.join(","),
      callbackCookieHeaderPresent: Boolean(cookieHeader),
      callbackStateCookiePresent: cookieNames.includes(STATE_COOKIE_NAME),
      oauthBeginSetCookies: beginSnapshot?.setCookies.join(" | ") ?? null,
      oauthBeginSetCookieCount: beginSnapshot?.setCookies.length ?? 0,
      oauthBeginSnapshotAgeMs: beginSnapshot
        ? Date.now() - beginSnapshot.capturedAt
        : null,
      message: formatOAuthCallbackErrorMessage(error),
      errorStack: extractErrorStack(error),
    },
  });
}

export function logShopifyAuthCallbackStart(shop: string | null): void {
  logOAuthCallbackPhase("shopify_auth_callback_start", shop);
}

export function logShopifyAuthCallbackSuccess(session: Session): void {
  logOAuthCallbackPhase("shopify_auth_callback_success", session.shop, {
    sessionId: session.id,
    isOnline: session.isOnline,
    accessTokenPresent: Boolean(session.accessToken),
  });
}

export function logShopifyAuthCallbackFailure(
  shop: string | null,
  error: unknown,
): void {
  logOAuthCallbackPhase("shopify_auth_callback_failure", shop, {
    failureType: classifyOAuthCallbackError(error),
    message: formatOAuthCallbackErrorMessage(error),
    errorStack: extractErrorStack(error),
  });
}

export function logAfterAuthSuccess(session: Session): void {
  logOAuthCallbackPhase("afterAuth_success", session.shop, {
    sessionId: session.id,
  });
}

export function logAfterAuthFailure(session: Session, error: unknown): void {
  logOAuthCallbackPhase("afterAuth_failure", session.shop, {
    sessionId: session.id,
    message: formatOAuthCallbackErrorMessage(error),
    errorStack: extractErrorStack(error),
  });
}

export function logPrismaStoreSessionSuccess(session: Session): void {
  logOAuthCallbackPhase("prisma_storeSession_success", session.shop, {
    sessionId: session.id,
  });
}

export function logPrismaStoreSessionFailure(
  session: Session,
  error: unknown,
): void {
  logOAuthCallbackPhase("prisma_storeSession_failure", session.shop, {
    sessionId: session.id,
    message: formatOAuthCallbackErrorMessage(error),
    errorStack: extractErrorStack(error),
  });
}

export function buildOAuthCallbackErrorResponse(error: unknown): Response {
  const status = oauthCallbackHttpStatus(error);
  const message = formatOAuthCallbackErrorMessage(error);

  return new Response(`OAuth callback failed: ${message}`, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function logOAuthCallbackUnhandledFailure(
  shop: string | null,
  error: unknown,
  request: Request,
): void {
  logOAuthCallbackValidationFailure(shop, error);
  logOAuthCallbackError(shop, error);

  if (
    error instanceof CookieNotFound ||
    error instanceof InvalidOAuthError ||
    error instanceof InvalidHmacError
  ) {
    logOAuthCallbackCookieDiagnostics(request, shop, error);
  }

  logListingFixEvent({
    action: "session_missing",
    shop,
    message: error,
    meta: {
      event: "oauth_callback_unhandled_failure",
      failureType: classifyOAuthCallbackError(error),
      message: formatOAuthCallbackErrorMessage(error),
      errorStack: extractErrorStack(error),
      httpStatus: oauthCallbackHttpStatus(error),
    },
  });
}

export function logOAuthCallbackRedirectReady(
  shop: string,
  redirectUrl: string,
): void {
  logOAuthCallbackPhase("oauth_callback_redirect_ready", shop, {
    redirectUrl,
  });
}

export {
  logAfterAuthPhase,
  logAuthCallbackCompleted,
  clearOAuthBeginCookieSnapshot,
};
