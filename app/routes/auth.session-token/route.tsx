import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  logEmbeddedAuthEvent,
  renderSessionTokenBouncePage,
} from "../../features/listingFix/embeddedAuth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  logEmbeddedAuthEvent("iframe_request", request, { route: "auth.session-token" });
  logEmbeddedAuthEvent("auth_redirect", request, {
    route: "auth.session-token",
    source: "session_token_bounce_page",
  });
  renderSessionTokenBouncePage(request);
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
