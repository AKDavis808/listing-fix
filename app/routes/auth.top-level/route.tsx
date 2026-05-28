import type { HeadersFunction, LoaderFunctionArgs } from "react-router";

import { authRouteHeaders } from "../../features/listingFix/authResponseHeaders.server";
import { renderAuthTopLevelEscapePage } from "../../features/listingFix/embeddedOAuthEscape.server";
import { normalizeShopifyAppUrl } from "../../features/listingFix/embeddedAuth.server";
import { logOAuthRouteEntered } from "../../features/listingFix/oauthSessionDiagnostics.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  logOAuthRouteEntered(url.pathname, shop, {
    route: "auth.top-level",
    event: "oauth_top_level_escape_route",
    hasHost: Boolean(url.searchParams.get("host")),
  });

  const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);
  return renderAuthTopLevelEscapePage(request, appUrl);
};

export const headers: HeadersFunction = (headersArgs) => {
  return authRouteHeaders(headersArgs);
};
