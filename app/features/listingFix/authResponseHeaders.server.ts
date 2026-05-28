import type { HeadersFunction } from "react-router";

import { mergeHeadersPreservingSetCookie } from "./setCookieHeaders.server";

export const authRouteHeaders: HeadersFunction = (headersArgs) => {
  const { parentHeaders, loaderHeaders, actionHeaders, errorHeaders } =
    headersArgs;

  if (errorHeaders && Array.from(errorHeaders.entries()).length > 0) {
    return mergeHeadersPreservingSetCookie([errorHeaders]);
  }

  return mergeHeadersPreservingSetCookie([
    parentHeaders,
    loaderHeaders,
    actionHeaders,
  ]);
};
