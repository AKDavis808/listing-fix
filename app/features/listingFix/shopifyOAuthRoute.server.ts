import { redirect } from "react-router";

import {
  logAuthCallbackCompleted,
  logAuthRouteEntered,
  logAfterAuthPhase,
  logOAuthCallbackError,
  logOAuthRouteEntered,
} from "./oauthSessionDiagnostics.server";
import {
  logOAuthBeginResponse,
  logOAuthCallbackEnteredDetailed,
  logOAuthCallbackQuery,
  logOAuthCallbackValidationFailure,
  logOAuthCallbackValidationSuccess,
} from "./oauthCallbackDiagnostics.server";
import { listingFixShopifyApi } from "./shopifyApi.server";
import {
  appendClearOAuthInProgressCookie,
  escapeEmbeddedOAuthBegin,
  logOAuthEmbeddedDetected,
  shouldEscapeEmbeddedOAuthBegin,
} from "./embeddedOAuthEscape.server";
import { applyEmbeddedOAuthCookiePolicy } from "./oauthCookiePolicy.server";
import { getOfflineSessionId, verifyPrismaSessionPersisted } from "./sessionPersistence.server";

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

function isAuthRootPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.endsWith("/auth");
}

function buildRedirectUri(appUrl: string, callbackPath: string): string {
  return `${appUrl.replace(/\/$/, "")}${callbackPath}`;
}

async function buildPostOAuthRedirectUrl(
  request: Request,
  shop: string,
  appUrl: string,
): Promise<string> {
  const host = new URL(request.url).searchParams.get("host");

  if (host) {
    return listingFixShopifyApi.auth.getEmbeddedAppUrl({ rawRequest: request });
  }

  return `${appUrl}/app?shop=${encodeURIComponent(shop)}&embedded=1`;
}

export async function handleOAuthCallbackRoute(
  request: Request,
  deps: OAuthRouteDeps,
  route: string,
): Promise<Response> {
  logOAuthCallbackQuery(request);
  logOAuthCallbackEnteredDetailed(
    new URL(request.url).searchParams.get("shop"),
    route,
  );

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");

  if (!code) {
    logOAuthCallbackValidationFailure(
      shop,
      new Error("OAuth callback missing code parameter"),
    );

    return new Response("OAuth callback missing code parameter", {
      status: 400,
    });
  }

  try {
    logListingFixEventBeforeCallback(shop);

    const { session, headers } = await listingFixShopifyApi.auth.callback({
      rawRequest: request,
      expiring: deps.expiringOfflineAccessTokens,
    });

    logOAuthCallbackValidationSuccess(session.shop);

    logAfterAuthPhase("afterAuth_before_storeSession", session, {
      route: "oauth.callback",
    });

    await deps.sessionStorage.storeSession(session);

    const prismaVerified = await verifyPrismaSessionPersisted(session);

    logAfterAuthPhase("afterAuth_after_storeSession", session, {
      prismaVerified,
      offlineSessionPersisted: prismaVerified,
      expectedOfflineSessionId: getOfflineSessionId(session.shop),
      offlineIdMatches: session.id === getOfflineSessionId(session.shop),
    });

    try {
      await deps.runAfterAuth(session, { storeSessionAlreadyCompleted: true });
    } catch (afterAuthError) {
      logOAuthCallbackError(session.shop, afterAuthError);
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

    const responseHeaders =
      headers instanceof Headers
        ? headers
        : new Headers(headers as Record<string, string>);

    appendClearOAuthInProgressCookie(responseHeaders);

    throw redirect(redirectUrl, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    logOAuthCallbackValidationFailure(shop, error);
    logOAuthCallbackError(shop, error);
    throw error;
  }
}

function logListingFixEventBeforeCallback(shop: string | null): void {
  logAuthRouteEntered("/auth/callback", shop, {
    event: "oauth_callback_execute_start",
    route: "shopify.auth.callback",
  });
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

  if (isAuthRootPath(pathname) && shop && !isCallback) {
    logOAuthRouteEntered(pathname, shop, {
      route: "auth._index",
      event: "oauth_begin_start",
    });
    logAuthRouteEntered(pathname, shop, {
      event: "auth_begin_entered",
      route: "oauth.begin",
    });

    if (shouldEscapeEmbeddedOAuthBegin(request)) {
      logOAuthEmbeddedDetected(request, shop);
    }

    const redirectUri = buildRedirectUri(deps.appUrl, deps.authCallbackPath);

    logAuthRouteEntered(pathname, shop, {
      event: "oauth_begin_redirect_uri",
      redirectUri,
      callbackPath: deps.authCallbackPath,
    });

    const beginResponse = applyEmbeddedOAuthCookiePolicy(
      (await listingFixShopifyApi.auth.begin({
        shop,
        callbackPath: deps.authCallbackPath,
        isOnline: false,
        rawRequest: request,
      })) as Response,
      request,
    );

    logOAuthBeginResponse(
      request,
      beginResponse,
      redirectUri,
      deps.authCallbackPath,
    );

    if (shouldEscapeEmbeddedOAuthBegin(request)) {
      escapeEmbeddedOAuthBegin(request, beginResponse, shop);
    }

    return beginResponse;
  }

  return null;
}
