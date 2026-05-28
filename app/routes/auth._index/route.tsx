import type { HeadersFunction, LoaderFunctionArgs } from "react-router";

import { authRouteHeaders } from "../../features/listingFix/authResponseHeaders.server";
import { logOAuthRouteEntered } from "../../features/listingFix/oauthSessionDiagnostics.server";
import {
  isEmbeddedOAuthRequest,
  logOAuthEmbeddedDetected,
} from "../../features/listingFix/embeddedOAuthEscape.server";
import { recordAuthFlowStep } from "../../features/listingFix/authFlowTelemetry.server";
import { handleShopifyOAuthAuthRoute } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  logOAuthRouteEntered(url.pathname, shop, {
    route: "auth._index",
    hasShop: Boolean(shop),
    embedded: url.searchParams.get("embedded") === "1",
    hasHost: Boolean(url.searchParams.get("host")),
    isEmbeddedOAuthRequest: isEmbeddedOAuthRequest(request),
  });

  if (isEmbeddedOAuthRequest(request)) {
    logOAuthEmbeddedDetected(request, shop);
  }

  recordAuthFlowStep(request, "auth_enter", {
    pathname: url.pathname,
    shop,
    embedded: url.searchParams.get("embedded"),
    hasHost: Boolean(url.searchParams.get("host")),
  });

  const oauthResponse = await handleShopifyOAuthAuthRoute(request);
  if (oauthResponse) {
    return oauthResponse;
  }

  return new Response("Missing shop parameter for OAuth", { status: 400 });
};

export const headers: HeadersFunction = (headersArgs) => {
  return authRouteHeaders(headersArgs);
};
