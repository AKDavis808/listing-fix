import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { handleShopifyOAuthAuthRoute } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const response = await handleShopifyOAuthAuthRoute(request);

  if (response) {
    return response;
  }

  return new Response("OAuth callback route handler returned no response", {
    status: 500,
  });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
