import type { HeadersFunction, LoaderFunctionArgs } from "react-router";

import { authRouteHeaders } from "../../features/listingFix/authResponseHeaders.server";
import { logExitIframeRouteEntered } from "../../features/listingFix/embeddedOAuthEscape.server";
import { authenticateAdminRaw } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  logExitIframeRouteEntered(request);
  await authenticateAdminRaw(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return authRouteHeaders(headersArgs);
};
