import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { logAuthRouteEntered } from "../../features/listingFix/oauthSessionDiagnostics.server";
import { ensureOfflineSessionOrRedirectToOAuth } from "../../features/listingFix/oauthRedirect.server";
import { logListingFixEvent } from "../../features/listingFix/telemetry";
import { authenticateAdminRaw } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const hasAuthorizationHeader = Boolean(request.headers.get("authorization"));

  logAuthRouteEntered(url.pathname, url.searchParams.get("shop"), {
    route: "auth.session-token",
    hasAuthorizationHeader,
    note: hasAuthorizationHeader
      ? "post_oauth_bounce_attempt"
      : "pre_oauth_bounce_blocked",
  });

  await ensureOfflineSessionOrRedirectToOAuth(
    request,
    "session_token_requires_offline_session",
  );

  if (!hasAuthorizationHeader) {
    logListingFixEvent({
      action: "oauth_start",
      shop: url.searchParams.get("shop"),
      meta: {
        event: "session_token_bounce_page",
        note: "offline session exists; App Bridge bounce HTML is expected here",
      },
    });
  }

  await authenticateAdminRaw(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
