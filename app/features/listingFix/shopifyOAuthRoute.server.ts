import { redirect } from "react-router";

import {
  logAuthCallbackCompleted,
  logAuthCallbackEntered,
  logAuthRouteEntered,
  logOAuthCallbackError,
} from "./oauthSessionDiagnostics.server";
import { listingFixShopifyApi } from "./shopifyApi.server";
import { getOfflineSessionId } from "./sessionPersistence.server";

type OAuthRouteDeps = {
  appUrl: string;
  authCallbackPath: string;
  expiringOfflineAccessTokens: boolean;
  runAfterAuth: (session: import("@shopify/shopify-api").Session) => Promise<void>;
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

export async function handleOAuthAuthRoute(
  request: Request,
  deps: OAuthRouteDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const shop = url.searchParams.get("shop");
  const isCallback = isOAuthCallbackPath(pathname);

  if (isCallback && url.searchParams.has("code")) {
    logAuthCallbackEntered(shop);

    try {
      const { session, headers } = await listingFixShopifyApi.auth.callback({
        rawRequest: request,
        expiring: deps.expiringOfflineAccessTokens,
      });

      await deps.sessionStorage.storeSession(session);
      await deps.runAfterAuth(session);

      logAuthCallbackCompleted(shop, {
        sessionId: session.id,
        expectedOfflineSessionId: getOfflineSessionId(session.shop),
        offlineIdMatches: session.id === getOfflineSessionId(session.shop),
        isOnline: session.isOnline,
        accessTokenPresent: Boolean(session.accessToken),
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

      throw redirect(redirectUrl, { headers: responseHeaders });
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }

      logOAuthCallbackError(shop, error);
      throw error;
    }
  }

  if (isAuthRootPath(pathname) && shop && !isCallback) {
    logAuthRouteEntered(pathname, shop, {
      event: "auth_begin_entered",
      route: "oauth.begin",
    });

    const beginResponse = await listingFixShopifyApi.auth.begin({
      shop,
      callbackPath: deps.authCallbackPath,
      isOnline: false,
      rawRequest: request,
    });

    return beginResponse as Response;
  }

  return null;
}
