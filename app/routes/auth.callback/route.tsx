import type { HeadersFunction, LoaderFunctionArgs } from "react-router";

import { authRouteHeaders } from "../../features/listingFix/authResponseHeaders.server";

import {
  buildOAuthCallbackErrorResponse,
  formatOAuthCallbackErrorMessage,
} from "../../features/listingFix/oauthCallbackTrace.server";
import { logListingFixEvent } from "../../features/listingFix/telemetry";
import { handleShopifyOAuthAuthRoute } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const response = await handleShopifyOAuthAuthRoute(request);

    if (response) {
      return response;
    }

    return new Response("OAuth callback route handler returned no response", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    const shop = new URL(request.url).searchParams.get("shop");

    logListingFixEvent({
      action: "session_missing",
      shop,
      message: error,
      meta: {
        event: "auth_callback_loader_failure",
        message: formatOAuthCallbackErrorMessage(error),
        errorStack:
          error instanceof Error && error.stack
            ? error.stack.slice(0, 2000)
            : undefined,
      },
    });

    return buildOAuthCallbackErrorResponse(error);
  }
};

export const headers: HeadersFunction = (headersArgs) => {
  return authRouteHeaders(headersArgs);
};
