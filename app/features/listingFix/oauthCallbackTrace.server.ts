import {
  CookieNotFound,
  InvalidHmacError,
  InvalidOAuthError,
  ShopifyError,
} from "@shopify/shopify-api";
import type { Session } from "@shopify/shopify-api";

import { clearOAuthBeginCookieSnapshot } from "./oauthBeginCookieSnapshot.server";
import {
  classifyOAuthCallbackError,
  logOAuthCallbackValidationFailure,
} from "./oauthCallbackDiagnostics.server";
import { isAuthDebugEnabled } from "./authDebugEnv.server";
import {
  logAfterAuthPhase,
  logAuthCallbackCompleted,
  logOAuthCallbackError,
} from "./oauthSessionDiagnostics.server";
import { logListingFixEvent, sanitizeErrorMessage } from "./telemetry";

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

export function logOAuthCallbackRequestContext(request: Request): void {
  if (!isAuthDebugEnabled()) return;

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "oauth_callback_entered",
      route: "auth.callback",
      pathname: url.pathname,
      oauth_callback_code_present: Boolean(url.searchParams.get("code")),
      oauth_callback_state_present: Boolean(url.searchParams.get("state")),
    },
  });
}

export function logShopifyAuthCallbackStart(shop: string | null): void {
  if (!isAuthDebugEnabled()) return;

  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: { event: "shopify_auth_callback_start" },
  });
}

export function logShopifyAuthCallbackSuccess(session: Session): void {
  logListingFixEvent({
    action: "oauth_complete",
    shop: session.shop,
    meta: {
      event: "shopify_auth_callback_success",
      sessionId: session.id,
      isOnline: session.isOnline,
      accessTokenPresent: Boolean(session.accessToken),
    },
  });
}

export function logShopifyAuthCallbackFailure(
  shop: string | null,
  error: unknown,
): void {
  logListingFixEvent({
    action: "session_missing",
    shop,
    message: error,
    meta: {
      event: "shopify_auth_callback_failure",
      failureType: classifyOAuthCallbackError(error),
      message: formatOAuthCallbackErrorMessage(error),
      errorStack: extractErrorStack(error),
    },
  });
}

export function logAfterAuthSuccess(session: Session): void {
  logListingFixEvent({
    action: "oauth_complete",
    shop: session.shop,
    meta: {
      event: "afterAuth_success",
      sessionId: session.id,
    },
  });
}

export function logAfterAuthFailure(session: Session, error: unknown): void {
  logListingFixEvent({
    action: "session_missing",
    shop: session.shop,
    message: error,
    meta: {
      event: "afterAuth_failure",
      sessionId: session.id,
      message: formatOAuthCallbackErrorMessage(error),
      errorStack: extractErrorStack(error),
    },
  });
}

export function logPrismaStoreSessionSuccess(session: Session): void {
  logListingFixEvent({
    action: "oauth_complete",
    shop: session.shop,
    meta: {
      event: "prisma_storeSession_success",
      sessionId: session.id,
    },
  });
}

export function logPrismaStoreSessionFailure(
  session: Session,
  error: unknown,
): void {
  logListingFixEvent({
    action: "session_missing",
    shop: session.shop,
    message: error,
    meta: {
      event: "prisma_storeSession_failure",
      sessionId: session.id,
      message: formatOAuthCallbackErrorMessage(error),
      errorStack: extractErrorStack(error),
    },
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
  _request: Request,
): void {
  logOAuthCallbackValidationFailure(shop, error);
  logOAuthCallbackError(shop, error);
}

export function logOAuthCallbackRedirectReady(
  shop: string,
  redirectUrl: string,
): void {
  if (!isAuthDebugEnabled()) return;

  logListingFixEvent({
    action: "oauth_complete",
    shop,
    meta: {
      event: "oauth_callback_redirect_ready",
      redirectUrl,
    },
  });
}

export {
  logAfterAuthPhase,
  logAuthCallbackCompleted,
  clearOAuthBeginCookieSnapshot,
};
