import { redirect } from "react-router";

import { logOAuthCallbackValidationSuccess } from "./oauthCallbackDiagnostics.server";
import {
  buildOAuthCallbackErrorResponse,
  clearOAuthBeginCookieSnapshot,
  logAfterAuthFailure,
  logAfterAuthPhase,
  logAfterAuthSuccess,
  logAuthCallbackCompleted,
  logOAuthCallbackRedirectReady,
  logOAuthCallbackRequestContext,
  logOAuthCallbackUnhandledFailure,
  logPrismaStoreSessionFailure,
  logPrismaStoreSessionSuccess,
  logShopifyAuthCallbackFailure,
  logShopifyAuthCallbackStart,
  logShopifyAuthCallbackSuccess,
} from "./oauthCallbackTrace.server";
import {
  appendClearOAuthInProgressCookie,
  redirectEmbeddedAuthToTopLevelEscape,
  shouldDeferOAuthBeginToTopLevel,
} from "./embeddedOAuthEscape.server";
import { applyEmbeddedOAuthCookiePolicy } from "./oauthCookiePolicy.server";
import { recordAuthFlowStep } from "./authFlowTelemetry.server";
import { getOfflineSessionId, verifyPrismaSessionPersisted } from "./sessionPersistence.server";
import { listingFixShopifyApi } from "./shopifyApi.server";
import { logListingFixEvent, sanitizeErrorMessage } from "./telemetry";

type OAuthRouteDeps = {
  appUrl: string;
  authCallbackPath: string;
  expiringOfflineAccessTokens: boolean;
  runAfterAuth: (
    session: import("@shopify/shopify-api").Session,
    options?: { storeSessionAlreadyCompleted?: boolean },
  ) => Promise<void>;
  sessionStorage: {
    storeSession: (
      session: import("@shopify/shopify-api").Session,
    ) => Promise<boolean>;
  };
};

function isOAuthCallbackPath(pathname: string): boolean {
  return (
    pathname.endsWith("/callback") || pathname.endsWith("/shopify/callback")
  );
}

function isAuthTopLevelPath(pathname: string): boolean {
  return pathname === "/auth/top-level" || pathname.endsWith("/auth/top-level");
}

function isAuthRootPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.endsWith("/auth");
}

function toResponseHeaders(headers: unknown): Headers {
  if (headers instanceof Headers) {
    return headers;
  }

  if (headers && typeof headers === "object") {
    return new Headers(headers as Record<string, string>);
  }

  return new Headers();
}

async function buildPostOAuthRedirectUrl(
  request: Request,
  shop: string,
  appUrl: string,
): Promise<string> {
  const host = new URL(request.url).searchParams.get("host");

  if (host) {
    try {
      return await listingFixShopifyApi.auth.getEmbeddedAppUrl({
        rawRequest: request,
      });
    } catch (error) {
      logListingFixEvent({
        action: "session_missing",
        shop,
        message: error,
        meta: {
          event: "oauth_callback_embedded_redirect_fallback",
          message: sanitizeErrorMessage(error),
          fallback: `${appUrl}/app?shop=${encodeURIComponent(shop)}&embedded=1`,
        },
      });
    }
  }

  return `${appUrl}/app?shop=${encodeURIComponent(shop)}&embedded=1`;
}

export async function handleOAuthCallbackRoute(
  request: Request,
  deps: OAuthRouteDeps,
  route: string,
): Promise<Response> {
  logOAuthCallbackRequestContext(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");

  if (!code) {
    return buildOAuthCallbackErrorResponse(
      new Error("OAuth callback missing code parameter"),
    );
  }

  try {
    logShopifyAuthCallbackStart(shop);

    const callbackResult = await listingFixShopifyApi.auth.callback({
      rawRequest: request,
      expiring: deps.expiringOfflineAccessTokens,
    });

    const session = callbackResult.session;
    const callbackHeaders = callbackResult.headers;

    logShopifyAuthCallbackSuccess(session);
    logOAuthCallbackValidationSuccess(session.shop);
    recordAuthFlowStep(request, "oauth_callback_validation_success", {
      shop: session.shop,
      sessionId: session.id,
    });

    logAfterAuthPhase("afterAuth_before_storeSession", session, {
      route: "oauth.callback",
    });

    try {
      await deps.sessionStorage.storeSession(session);
      logPrismaStoreSessionSuccess(session);
      recordAuthFlowStep(request, "prisma_storeSession_success", {
        shop: session.shop,
        sessionId: session.id,
      });
    } catch (storeSessionError) {
      logPrismaStoreSessionFailure(session, storeSessionError);
      recordAuthFlowStep(request, "prisma_storeSession_failure", {
        shop: session.shop,
        sessionId: session.id,
        message: sanitizeErrorMessage(storeSessionError),
      });
      throw storeSessionError;
    }

    const prismaVerified = await verifyPrismaSessionPersisted(session);

    recordAuthFlowStep(request, "prisma_session_lookup_after_save", {
      shop: session.shop,
      sessionId: session.id,
      prismaVerified,
    });

    logAfterAuthPhase("afterAuth_after_storeSession", session, {
      prismaVerified,
      offlineSessionPersisted: prismaVerified,
      expectedOfflineSessionId: getOfflineSessionId(session.shop),
      offlineIdMatches: session.id === getOfflineSessionId(session.shop),
    });

    try {
      await deps.runAfterAuth(session, { storeSessionAlreadyCompleted: true });
      logAfterAuthSuccess(session);
    } catch (afterAuthError) {
      logAfterAuthFailure(session, afterAuthError);
    }

    logAuthCallbackCompleted(session.shop, {
      sessionId: session.id,
      expectedOfflineSessionId: getOfflineSessionId(session.shop),
      offlineIdMatches: session.id === getOfflineSessionId(session.shop),
      isOnline: session.isOnline,
      accessTokenPresent: Boolean(session.accessToken),
      route,
    });

    const redirectUrl = await buildPostOAuthRedirectUrl(
      request,
      session.shop,
      deps.appUrl,
    );

    logOAuthCallbackRedirectReady(session.shop, redirectUrl);

    const responseHeaders = toResponseHeaders(callbackHeaders);
    appendClearOAuthInProgressCookie(responseHeaders);
    clearOAuthBeginCookieSnapshot(session.shop);

    throw redirect(redirectUrl, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    logShopifyAuthCallbackFailure(shop, error);
    logOAuthCallbackUnhandledFailure(shop, error, request);
    recordAuthFlowStep(request, "oauth_callback_validation_failure", {
      shop,
      failureType: error instanceof Error ? error.name : "unknown",
      message: sanitizeErrorMessage(error),
    });

    return buildOAuthCallbackErrorResponse(error);
  }
}

export async function handleOAuthAuthRoute(
  request: Request,
  deps: OAuthRouteDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const shop = url.searchParams.get("shop");
  const isCallback = isOAuthCallbackPath(pathname);

  if (isCallback) {
    return handleOAuthCallbackRoute(request, deps, "shopifyOAuthRoute");
  }

  if (isAuthTopLevelPath(pathname)) {
    return null;
  }

  if (isAuthRootPath(pathname) && shop && !isCallback) {
    if (shouldDeferOAuthBeginToTopLevel(request)) {
      redirectEmbeddedAuthToTopLevelEscape(request);
    }

    logListingFixEvent({
      action: "oauth_start",
      shop,
      meta: {
        event: "oauth_begin",
        pathname,
      },
    });

    recordAuthFlowStep(request, "auth_begin_start", {
      pathname,
      shop,
    });

    const rawBeginResponse = (await listingFixShopifyApi.auth.begin({
      shop,
      callbackPath: deps.authCallbackPath,
      isOnline: false,
      rawRequest: request,
    })) as Response;

    const { response: beginResponse } = applyEmbeddedOAuthCookiePolicy(
      rawBeginResponse,
      request,
    );

    return beginResponse;
  }

  return null;
}
