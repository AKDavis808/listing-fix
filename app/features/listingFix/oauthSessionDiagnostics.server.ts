import type { Session } from "@shopify/shopify-api";

import db from "../../db.server";
import { getOfflineSessionId } from "./sessionPersistence.server";
import { logListingFixEvent, sanitizeErrorMessage } from "./telemetry";

const REQUIRED_SESSION_FIELDS = [
  "id",
  "shop",
  "state",
  "isOnline",
  "scope",
  "expires",
  "accessToken",
  "userId",
] as const;

export async function logStartupSessionDiagnostics(): Promise<void> {
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
        schemaFieldsPresent: REQUIRED_SESSION_FIELDS,
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
  pathname: string,
  shop: string | null,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "auth_route_entered",
      pathname,
      ...meta,
    },
  });
}

export function logOAuthRouteEntered(
  pathname: string,
  shop: string | null,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "oauth_route_entered",
      pathname,
      route: "auth",
      ...meta,
    },
  });
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
      hasHost: Boolean(url.searchParams.get("host")),
    },
  });
}

export function logAuthCallbackEntered(
  shop: string | null,
  route = "auth.callback",
): void {
  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "oauth_callback_entered",
      route,
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
      route: "auth.$",
      ...meta,
    },
  });
}

export function logAfterAuthStart(session: Session): void {
  const expectedOfflineSessionId = getOfflineSessionId(session.shop);

  logListingFixEvent({
    action: "oauth_complete",
    shop: session.shop,
    meta: {
      event: "afterAuth_start",
      afterAuth_shop: session.shop,
      afterAuth_session_id: session.id,
      afterAuth_isOnline: session.isOnline,
      afterAuth_accessToken_present: Boolean(session.accessToken),
      afterAuth_expires_present: Boolean(session.expires),
      afterAuth_scope_present: Boolean(session.scope),
      expectedOfflineSessionId,
      offlineIdMatches: session.id === expectedOfflineSessionId,
      isOfflineSession: session.isOnline === false,
    },
  });
}

export function logAfterAuthFinished(
  session: Session,
  prismaVerified: boolean,
  storeSessionSucceeded?: boolean,
): void {
  logListingFixEvent({
    action: prismaVerified ? "session_restored" : "session_missing",
    shop: session.shop,
    meta: {
      event: "afterAuth_complete",
      afterAuth_shop: session.shop,
      afterAuth_session_id: session.id,
      afterAuth_isOnline: session.isOnline,
      afterAuth_accessToken_present: Boolean(session.accessToken),
      prismaVerified,
      storeSessionSucceeded,
      expectedOfflineSessionId: getOfflineSessionId(session.shop),
      offlineIdMatches: session.id === getOfflineSessionId(session.shop),
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
    },
  });
}

export function logAuthRouteWiringDiagnostic(
  appUrl: string,
  distribution: string,
): void {
  logListingFixEvent({
    action: "session_restored",
    meta: {
      event: "auth_route_wiring",
      authPathPrefix: "/auth",
      callbackPath: "/auth/callback",
      routesMounted: [
        "routes/auth._index (/auth)",
        "routes/auth.callback (/auth/callback)",
        "routes/auth.$ (auth/* fallback)",
        "routes/auth.login",
        "routes/auth.session-token",
      ],
      distribution,
      appUrl,
      note: "Missing offline session must redirect to /auth (OAuth begin), not /auth/session-token bounce; session-token only after OAuth succeeds",
    },
  });
}

export function logStoreSessionStart(session: Session): void {
  const expectedOfflineSessionId = getOfflineSessionId(session.shop);

  logListingFixEvent({
    action: "oauth_start",
    shop: session.shop,
    meta: {
      event: "storeSession_start",
      sessionId: session.id,
      sessionShop: session.shop,
      isOnline: session.isOnline,
      accessTokenPresent: Boolean(session.accessToken),
      expiresPresent: Boolean(session.expires),
      scopePresent: Boolean(session.scope),
      expectedOfflineSessionId,
      offlineIdMatches: session.id === expectedOfflineSessionId,
      isOfflineSession: session.isOnline === false,
    },
  });
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
      sessionShop: session.shop,
      isOnline: session.isOnline,
      stored,
      prismaVerified,
      isOfflineSession: session.isOnline === false,
      expectedOfflineSessionId: getOfflineSessionId(session.shop),
      offlineIdMatches: session.id === getOfflineSessionId(session.shop),
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
      sessionShop: session.shop,
      isOnline: session.isOnline,
      message: sanitizeErrorMessage(error),
    },
  });
}

export function logLoadSessionResult(
  sessionId: string,
  session: Session | undefined,
): void {
  if (session) {
    logListingFixEvent({
      action: "session_restored",
      shop: session.shop,
      meta: {
        event: "prisma_session_lookup",
        sessionId,
        found: true,
        sessionShop: session.shop,
        isOnline: session.isOnline,
        accessTokenPresent: Boolean(session.accessToken),
        expectedOfflineSessionId: getOfflineSessionId(session.shop),
        offlineIdMatches: session.id === getOfflineSessionId(session.shop),
      },
    });
    return;
  }

  logListingFixEvent({
    action: "session_missing",
    meta: {
      event: "prisma_session_lookup_failed",
      sessionId,
      reason: "load_session_miss",
    },
  });
}
