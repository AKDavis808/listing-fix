import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { logExitIframeRouteEntered } from "../../features/listingFix/embeddedOAuthEscape.server";
import { authenticateAdminRaw } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  logExitIframeRouteEntered(request);
  await authenticateAdminRaw(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
