import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { logAuthRouteEntered } from "../../features/listingFix/oauthSessionDiagnostics.server";
import { authenticate } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  logAuthRouteEntered(url.pathname, url.searchParams.get("shop"), {
    route: "auth.session-token",
    hasAuthorizationHeader: Boolean(request.headers.get("authorization")),
  });

  await authenticate.admin(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
