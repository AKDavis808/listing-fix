import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { logAuthCallbackEntered } from "../../features/listingFix/oauthSessionDiagnostics.server";
import { handleShopifyOAuthAuthRoute } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  logAuthCallbackEntered(url.searchParams.get("shop"), "auth.callback");

  await handleShopifyOAuthAuthRoute(request);

  return new Response("OAuth callback missing code parameter", { status: 400 });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
