import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { logAuthRouteEntered } from "../../features/listingFix/oauthSessionDiagnostics.server";
import { logListingFixEvent } from "../../features/listingFix/telemetry";
import { authenticate } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const hasAuthorizationHeader = Boolean(request.headers.get("authorization"));

  logAuthRouteEntered(url.pathname, url.searchParams.get("shop"), {
    route: "auth.session-token",
    hasAuthorizationHeader,
    note: hasAuthorizationHeader
      ? "bearer_present_may_still_render_bounce_page"
      : "bounce_page_only_200_not_session_saved",
  });

  if (!hasAuthorizationHeader) {
    logListingFixEvent({
      action: "oauth_start",
      shop: url.searchParams.get("shop"),
      meta: {
        event: "session_token_bounce_page",
        note: "200 on /auth/session-token is App Bridge bounce HTML, not prisma_session_saved",
      },
    });
  }

  await authenticate.admin(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
