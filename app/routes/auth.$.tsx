import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { logListingFixEvent } from "../features/listingFix/telemetry";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isCallback =
    url.pathname.endsWith("/callback") ||
    url.pathname.endsWith("/shopify/callback");

  if (isCallback) {
    logListingFixEvent({
      action: "oauth_start",
      shop: url.searchParams.get("shop"),
      meta: { route: "auth.$", event: "oauth_callback_entered" },
    });
  }

  await authenticate.admin(request);

  if (isCallback) {
    logListingFixEvent({
      action: "oauth_complete",
      shop: url.searchParams.get("shop"),
      meta: { route: "auth.$", event: "oauth_callback_completed" },
    });
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
