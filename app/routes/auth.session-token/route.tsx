import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { renderSessionTokenBouncePage } from "../../features/listingFix/embeddedAuth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  renderSessionTokenBouncePage(request);
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
