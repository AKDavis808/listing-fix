import { redirect } from "react-router";

import { logListingFixEvent } from "./telemetry";

const OAUTH_IN_PROGRESS_COOKIE = "listingfix_oauth_in_progress";
const EXIT_IFRAME_PATH = "/auth/exit-iframe";
const APP_BRIDGE_SCRIPT_URL =
  "https://cdn.shopify.com/shopifycloud/app-bridge.js";

export function isEmbeddedOAuthRequest(request: Request): boolean {
  const url = new URL(request.url);

  if (url.searchParams.get("embedded") === "1") {
    return true;
  }

  if (url.searchParams.get("host")) {
    return true;
  }

  return request.headers.get("sec-fetch-dest") === "iframe";
}

export function isOAuthInProgress(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader.includes(`${OAUTH_IN_PROGRESS_COOKIE}=1`);
}

export function buildOAuthInProgressCookie(): string {
  return `${OAUTH_IN_PROGRESS_COOKIE}=1; Path=/; Max-Age=300; SameSite=None; Secure; HttpOnly`;
}

export function buildClearOAuthInProgressCookie(): string {
  return `${OAUTH_IN_PROGRESS_COOKIE}=; Path=/; Max-Age=0; SameSite=None; Secure; HttpOnly`;
}

export function copySetCookieHeaders(source: Headers, target: Headers): void {
  if (typeof source.getSetCookie === "function") {
    for (const cookie of source.getSetCookie()) {
      target.append("set-cookie", cookie);
    }
    return;
  }

  const combined = source.get("set-cookie");
  if (combined) {
    target.append("set-cookie", combined);
  }
}

function extractEmbeddedContext(request: Request) {
  const url = new URL(request.url);

  return {
    embedded: url.searchParams.get("embedded") === "1",
    hasHost: Boolean(url.searchParams.get("host")),
    secFetchDest: request.headers.get("sec-fetch-dest"),
    isEmbedded: isEmbeddedOAuthRequest(request),
  };
}

export function logOAuthEmbeddedDetected(
  request: Request,
  shop: string | null,
): void {
  const ctx = extractEmbeddedContext(request);

  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "oauth_embedded_detected",
      pathname: new URL(request.url).pathname,
      embedded: ctx.embedded,
      hasHost: ctx.hasHost,
      secFetchDest: ctx.secFetchDest,
      isEmbeddedOAuthRequest: ctx.isEmbedded,
    },
  });
}

export function logOAuthAuthorizeUrlGenerated(
  request: Request,
  shop: string | null,
  authorizeUrl: string,
): void {
  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "oauth_authorize_url_generated",
      oauth_redirect_location: authorizeUrl,
      authorizeHost: safeUrlHost(authorizeUrl),
    },
  });
}

export function logOAuthEscapeTopLevelStarted(
  request: Request,
  shop: string | null,
  authorizeUrl: string,
  strategy: "app_bridge_html" | "exit_iframe_redirect",
): void {
  logListingFixEvent({
    action: "auth_redirect",
    shop,
    meta: {
      event: "oauth_escape_top_level_started",
      oauth_redirect_location: authorizeUrl,
      oauth_top_level_redirect: true,
      escaped_iframe_for_oauth: true,
      strategy,
      embedded: new URL(request.url).searchParams.get("embedded") === "1",
      hasHost: Boolean(new URL(request.url).searchParams.get("host")),
    },
  });
}

export function logOAuthInProgressSkip(request: Request, shop: string | null): void {
  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "oauth_in_progress_skip_redirect",
      pathname: new URL(request.url).pathname,
      reason: "oauth_already_in_progress",
    },
  });
}

function buildEmbeddedFrameAncestorsCsp(shop: string): string {
  return `frame-ancestors https://${shop} https://admin.shopify.com https://*.spin.dev https://admin.myshopify.io https://admin.shop.dev;`;
}

function buildAppBridgeEscapeHtml(apiKey: string, authorizeUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script data-api-key="${apiKey}" src="${APP_BRIDGE_SCRIPT_URL}"></script>
</head>
<body>
  <script>window.open(${JSON.stringify(authorizeUrl)}, ${JSON.stringify("_top")})</script>
</body>
</html>`;
}

export function throwEmbeddedOAuthTopLevelEscape(
  request: Request,
  beginResponse: Response,
  shop: string,
): never {
  const authorizeUrl = beginResponse.headers.get("location");

  if (!authorizeUrl) {
    throw new Response("OAuth begin missing Location header", { status: 500 });
  }

  logOAuthEmbeddedDetected(request, shop);
  logOAuthAuthorizeUrlGenerated(request, shop, authorizeUrl);
  logOAuthEscapeTopLevelStarted(request, shop, authorizeUrl, "app_bridge_html");

  const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";
  const headers = new Headers({
    "content-type": "text/html;charset=utf-8",
  });

  copySetCookieHeaders(beginResponse.headers, headers);
  headers.append("set-cookie", buildOAuthInProgressCookie());
  headers.set("Content-Security-Policy", buildEmbeddedFrameAncestorsCsp(shop));

  throw new Response(buildAppBridgeEscapeHtml(apiKey, authorizeUrl), {
    status: 200,
    headers,
  });
}

export function throwEmbeddedOAuthExitIframeRedirect(
  request: Request,
  beginResponse: Response,
  shop: string,
): never {
  const url = new URL(request.url);
  const host = url.searchParams.get("host");
  const authorizeUrl = beginResponse.headers.get("location");

  if (!authorizeUrl) {
    throw new Response("OAuth begin missing Location header", { status: 500 });
  }

  if (!host) {
    throw new Response("Embedded OAuth requires host parameter", { status: 400 });
  }

  logOAuthEmbeddedDetected(request, shop);
  logOAuthAuthorizeUrlGenerated(request, shop, authorizeUrl);
  logOAuthEscapeTopLevelStarted(
    request,
    shop,
    authorizeUrl,
    "exit_iframe_redirect",
  );

  const exitParams = new URLSearchParams({
    shop,
    host,
    exitIframe: authorizeUrl,
  });
  const exitIframeUrl = `${EXIT_IFRAME_PATH}?${exitParams.toString()}`;

  const headers = new Headers();
  copySetCookieHeaders(beginResponse.headers, headers);
  headers.append("set-cookie", buildOAuthInProgressCookie());

  throw redirect(exitIframeUrl, { headers });
}

export function escapeEmbeddedOAuthBegin(
  request: Request,
  beginResponse: Response,
  shop: string,
): never {
  throwEmbeddedOAuthTopLevelEscape(request, beginResponse, shop);
}

export function shouldEscapeEmbeddedOAuthBegin(request: Request): boolean {
  return isEmbeddedOAuthRequest(request);
}

export function appendClearOAuthInProgressCookie(headers: Headers): void {
  headers.append("set-cookie", buildClearOAuthInProgressCookie());
}

export function logExitIframeRouteEntered(request: Request): void {
  const url = new URL(request.url);
  const authorizeUrl = url.searchParams.get("exitIframe");

  logListingFixEvent({
    action: "oauth_start",
    shop: url.searchParams.get("shop"),
    meta: {
      event: "escaped_iframe_for_oauth",
      pathname: url.pathname,
      oauth_redirect_location: authorizeUrl,
      auth_response_location: authorizeUrl,
      hasExitIframeParam: Boolean(authorizeUrl),
    },
  });

  if (authorizeUrl) {
    logOAuthEscapeTopLevelStarted(
      request,
      url.searchParams.get("shop"),
      authorizeUrl,
      "exit_iframe_redirect",
    );
  }
}

function safeUrlHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}
