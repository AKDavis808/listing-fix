import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { logAuthRouteEntered } from "../features/listingFix/oauthSessionDiagnostics.server";
import { authenticateAdminRaw } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  logAuthRouteEntered(url.pathname, shop, {
    route: "auth.$",
    isCallback:
      url.pathname.endsWith("/callback") ||
      url.pathname.endsWith("/shopify/callback"),
    note: "auth_catchall_fallback",
  });

  await authenticateAdminRaw(request);

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
