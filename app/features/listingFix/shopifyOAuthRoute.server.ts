import { redirect } from "react-router";

import {
  logOAuthBeginResponse,
  logOAuthCallbackQuery,
  logOAuthCallbackValidationSuccess,
} from "./oauthCallbackDiagnostics.server";
import {
  logOAuthCallbackPreValidation,
  runOAuthCallbackPreValidation,
} from "./oauthCallbackPreValidation.server";
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
  logOAuthEmbeddedDetected,
  redirectEmbeddedAuthToTopLevelEscape,
  shouldDeferOAuthBeginToTopLevel,
} from "./embeddedOAuthEscape.server";
import { applyEmbeddedOAuthCookiePolicy } from "./oauthCookiePolicy.server";
import { recordAuthFlowStep } from "./authFlowTelemetry.server";
import {
  countSetCookieHeaders,
  extractSetCookieHeaders,
} from "./setCookieHeaders.server";
import {
  logAuthRouteEntered,
  logOAuthRouteEntered,
} from "./oauthSessionDiagnostics.server";
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

function buildRedirectUri(appUrl: string, callbackPath: string): string {
  return `${appUrl.replace(/\/$/, "")}${callbackPath}`;
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
  logOAuthCallbackQuery(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");

  if (!code) {
    return buildOAuthCallbackErrorResponse(
      new Error("OAuth callback missing code parameter"),
    );
  }

  let preValidation: Awaited<
    ReturnType<typeof runOAuthCallbackPreValidation>
  > | null = null;

  try {
    preValidation = await runOAuthCallbackPreValidation(request, {
      appUrl: deps.appUrl,
      authCallbackPath: deps.authCallbackPath,
    });
    logOAuthCallbackPreValidation(request, preValidation);
    recordAuthFlowStep(request, "oauth_callback_pre_validation", {
      shop: preValidation.callback_shop,
      callback_hmac_valid: preValidation.callback_hmac_valid,
      callback_state_matches_cookie: preValidation.callback_state_matches_cookie,
      duplicate_state_cookie_detected:
        preValidation.duplicate_state_cookie_detected,
      redirect_uri_matches_expected: preValidation.redirect_uri_matches_expected,
      configured_api_key_matches_toml_client_id:
        preValidation.configured_api_key_matches_toml_client_id,
    });

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
    logOAuthCallbackUnhandledFailure(shop, error, request, preValidation);
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
    logOAuthRouteEntered(pathname, shop, {
      route: "auth._index",
      event: "oauth_begin_start",
    });
    logAuthRouteEntered(pathname, shop, {
      event: "auth_begin_entered",
      route: "oauth.begin",
    });

    if (shouldDeferOAuthBeginToTopLevel(request)) {
      logOAuthEmbeddedDetected(request, shop);
      redirectEmbeddedAuthToTopLevelEscape(request);
    }

    const redirectUri = buildRedirectUri(deps.appUrl, deps.authCallbackPath);

    logAuthRouteEntered(pathname, shop, {
      event: "oauth_top_level_auth_begin",
      redirectUri,
      callbackPath: deps.authCallbackPath,
      embedded: new URL(request.url).searchParams.get("embedded"),
      secFetchDest: request.headers.get("sec-fetch-dest"),
    });

    recordAuthFlowStep(request, "auth_begin_start", {
      pathname,
      shop,
      redirectUri,
    });

    const rawBeginResponse = (await listingFixShopifyApi.auth.begin({
      shop,
      callbackPath: deps.authCallbackPath,
      isOnline: false,
      rawRequest: request,
    })) as Response;

    const authBeginSetCookieCount = countSetCookieHeaders(
      rawBeginResponse.headers,
    );

    const { response: beginResponse, setCookies } =
      applyEmbeddedOAuthCookiePolicy(rawBeginResponse, request);

    logListingFixEvent({
      action: "oauth_start",
      shop,
      meta: {
        event: "oauth_top_level_set_cookie_count",
        oauth_top_level_set_cookie_count: authBeginSetCookieCount,
        policy_set_cookie_count: setCookies.length,
        auth_begin_set_cookie_count: authBeginSetCookieCount,
        rawSetCookieNames: extractSetCookieHeaders(rawBeginResponse.headers)
          .map((cookie) => cookie.split("=")[0])
          .join(","),
      },
    });

    recordAuthFlowStep(request, "auth_begin_set_cookie_count", {
      shop,
      auth_begin_set_cookie_count: authBeginSetCookieCount,
      policy_set_cookie_count: setCookies.length,
    });

    const authorizeUrl = beginResponse.headers.get("location");
    if (authorizeUrl) {
      recordAuthFlowStep(request, "oauth_authorize_url", {
        shop,
        oauth_redirect_location: authorizeUrl,
      });
    }

    logOAuthBeginResponse(
      request,
      beginResponse,
      redirectUri,
      deps.authCallbackPath,
    );

    return beginResponse;
  }

  return null;
}
