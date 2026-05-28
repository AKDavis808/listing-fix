import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  logAuthCallbackCompleted,
  logAuthCallbackEntered,
  logAuthRouteEntered,
} from "../features/listingFix/oauthSessionDiagnostics.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const isCallback =
    url.pathname.endsWith("/callback") ||
    url.pathname.endsWith("/shopify/callback");

  logAuthRouteEntered(url.pathname, shop, {
    route: "auth.$",
    isCallback,
  });

  if (isCallback) {
    logAuthCallbackEntered(shop);
  }

  await authenticate.admin(request);

  if (isCallback) {
    logAuthCallbackCompleted(shop);
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
