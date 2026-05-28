import type { HeadersFunction, LoaderFunctionArgs } from "react-router";

import { authRouteHeaders } from "../../features/listingFix/authResponseHeaders.server";
import {
  buildAuthDebugSnapshot,
  renderAuthDebugHtml,
} from "../../features/listingFix/authDebugSnapshot.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const snapshot = await buildAuthDebugSnapshot(request);

  if (!snapshot.enabled) {
    return new Response("Auth debug disabled", { status: 404 });
  }

  return new Response(renderAuthDebugHtml(snapshot), {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
};

export const headers: HeadersFunction = (headersArgs) => {
  return authRouteHeaders(headersArgs);
};
