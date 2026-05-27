
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { logEmbeddedAuthEvent } from "../features/listingFix/embeddedAuth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isCallback =
    url.pathname.endsWith("/callback") ||
    url.pathname.endsWith("/shopify/callback");

  logEmbeddedAuthEvent("iframe_request", request, { route: "auth.$" });

  try {
    await authenticate.admin(request);

    if (isCallback) {
      logEmbeddedAuthEvent("oauth_complete", request, { route: "auth.$" });
    }
  } catch (error) {
    if (
      isCallback &&
      error instanceof Response &&
      error.status >= 300 &&
      error.status < 400
    ) {
      logEmbeddedAuthEvent("oauth_complete", request, {
        route: "auth.$",
        redirectStatus: error.status,
      });
    }
    throw error;
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
