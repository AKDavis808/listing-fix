import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { logOAuthRouteEntered } from "../../features/listingFix/oauthSessionDiagnostics.server";
import { handleShopifyOAuthAuthRoute } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  logOAuthRouteEntered(url.pathname, shop, {
    route: "auth._index",
    hasShop: Boolean(shop),
  });

  const oauthResponse = await handleShopifyOAuthAuthRoute(request);
  if (oauthResponse) {
    return oauthResponse;
  }

  return new Response("Missing shop parameter for OAuth", { status: 400 });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
