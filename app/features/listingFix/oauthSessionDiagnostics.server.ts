import type { Session } from "@shopify/shopify-api";

import db from "../../db.server";
import { isAuthDebugEnabled } from "./authDebugEnv.server";
import { isEmbeddedOAuthRequest } from "./embeddedOAuthEscape.server";
import { getOfflineSessionId } from "./sessionPersistence.server";
import { logListingFixEvent, sanitizeErrorMessage } from "./telemetry";

export async function logStartupSessionDiagnostics(): Promise<void> {
  if (!isAuthDebugEnabled()) return;

  try {
    const totalCount = await db.session.count();
    const offlineCount = await db.session.count({
      where: { isOnline: false },
    });
    const onlineCount = await db.session.count({
      where: { isOnline: true },
    });

    logListingFixEvent({
      action: "session_restored",
      meta: {
        event: "prisma_session_startup_count",
        totalCount,
        offlineCount,
        onlineCount,
      },
    });
  } catch (error) {
    logListingFixEvent({
      action: "session_missing",
      message: error,
      meta: {
        event: "prisma_session_startup_count_failed",
      },
    });
  }
}

export function logAuthRouteEntered(
  _pathname: string,
  _shop: string | null,
  _meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  // Reserved for auth debug tooling only.
}

export function logOAuthRouteEntered(
  _pathname: string,
  _shop: string | null,
  _meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  // Reserved for auth debug tooling only.
}

export function logRedirectToOAuth(
  request: Request,
  shop: string,
  offlineSessionId: string,
  reason: string,
  target: string,
): void {
  const url = new URL(request.url);

  logListingFixEvent({
    action: "auth_redirect",
    shop,
    meta: {
      event: "redirect_to_oauth",
      reason,
      target,
      fromPathname: url.pathname,
      offlineSessionId,
      embedded: url.searchParams.get("embedded") === "1",
      isEmbeddedOAuthRequest: isEmbeddedOAuthRequest(request),
    },
  });
}

export function logAuthCallbackCompleted(
  shop: string | null,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  logListingFixEvent({
    action: "oauth_complete",
    shop,
    meta: {
      event: "oauth_callback_completed",
      ...meta,
    },
  });
}

export function logAfterAuthPhase(
  event:
    | "afterAuth_start"
    | "afterAuth_before_storeSession"
    | "afterAuth_after_storeSession"
    | "afterAuth_before_webhooks"
    | "afterAuth_after_webhooks"
    | "afterAuth_complete",
  session: Session,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isAuthDebugEnabled()) return;

  logListingFixEvent({
    action: event === "afterAuth_complete" ? "oauth_complete" : "oauth_start",
    shop: session.shop,
    meta: {
      event,
      sessionId: session.id,
      ...meta,
    },
  });
}

export function logAfterAuthFinished(
  session: Session,
  prismaVerified: boolean,
  storeSessionSucceeded?: boolean,
): void {
  logListingFixEvent({
    action: prismaVerified ? "oauth_complete" : "session_missing",
    shop: session.shop,
    meta: {
      event: "afterAuth_complete",
      sessionId: session.id,
      prismaVerified,
      storeSessionSucceeded,
    },
  });
}

export function logAfterAuthWebhookFailure(
  session: Session,
  error: unknown,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  logListingFixEvent({
    action: "session_missing",
    shop: session.shop,
    message: error,
    meta: {
      event: "afterAuth_webhook_registration_failed",
      message: sanitizeErrorMessage(error),
      ...meta,
    },
  });
}

export function logAfterAuthWebhookSuccess(
  session: Session,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  logListingFixEvent({
    action: "oauth_complete",
    shop: session.shop,
    meta: {
      event: "afterAuth_after_webhooks",
      ...meta,
    },
  });
}

export function logAppAuthenticateSuccess(shop: string, sessionId: string): void {
  logListingFixEvent({
    action: "session_restored",
    shop,
    meta: {
      event: "authenticate_admin_success",
      sessionId,
      expectedOfflineSessionId: getOfflineSessionId(shop),
      offlineIdMatches: sessionId === getOfflineSessionId(shop),
    },
  });
}

export function logOAuthCallbackError(shop: string | null, error: unknown): void {
  logListingFixEvent({
    action: "session_missing",
    shop,
    message: error,
    meta: {
      event: "oauth_callback_error",
      message: sanitizeErrorMessage(error),
      errorStack:
        error instanceof Error && error.stack
          ? error.stack.slice(0, 2000)
          : undefined,
    },
  });
}

export function logAuthRouteWiringDiagnostic(
  _appUrl: string,
  _distribution: string,
): void {
  // Reserved for auth debug tooling only.
}

export function logStoreSessionStart(_session: Session): void {
  // Reserved for auth debug tooling only.
}

export function logStoreSessionSuccess(
  session: Session,
  stored: boolean,
  prismaVerified: boolean,
): void {
  logListingFixEvent({
    action: prismaVerified ? "session_restored" : "session_missing",
    shop: session.shop,
    meta: {
      event: "prisma_session_saved",
      sessionId: session.id,
      stored,
      prismaVerified,
      isOfflineSession: session.isOnline === false,
    },
  });
}

export function logStoreSessionFailure(session: Session, error: unknown): void {
  logListingFixEvent({
    action: "session_missing",
    shop: session.shop,
    message: error,
    meta: {
      event: "storeSession_error",
      sessionId: session.id,
      message: sanitizeErrorMessage(error),
      errorStack:
        error instanceof Error && error.stack
          ? error.stack.slice(0, 2000)
          : undefined,
    },
  });
}

export function logLoadSessionResult(
  _sessionId: string,
  _session: Session | undefined,
): void {
  // Reserved for auth debug tooling only.
}
