import { redirect } from "react-router";

import { logListingFixEvent } from "./telemetry";
import { readAuthFlowId, recordAuthFlowStep } from "./authFlowTelemetry.server";

const OAUTH_IN_PROGRESS_COOKIE = "listingfix_oauth_in_progress";
const EXIT_IFRAME_PATH = "/auth/exit-iframe";
export const AUTH_TOP_LEVEL_PATH = "/auth/top-level";
const APP_BRIDGE_SCRIPT_URL =
  "https://cdn.shopify.com/shopifycloud/app-bridge.js";

export function isEmbeddedOAuthRequest(request: Request): boolean {
  const url = new URL(request.url);

  if (url.searchParams.get("embedded") === "0") {
    return false;
  }

  if (url.searchParams.get("embedded") === "1") {
    return true;
  }

  if (url.searchParams.get("host")) {
    return true;
  }

  return request.headers.get("sec-fetch-dest") === "iframe";
}

export function shouldDeferOAuthBeginToTopLevel(request: Request): boolean {
  return isEmbeddedOAuthRequest(request);
}

export function buildAuthTopLevelEscapeUrl(request: Request): string {
  const url = new URL(request.url);
  const params = new URLSearchParams();

  const shop = url.searchParams.get("shop");
  if (shop) params.set("shop", shop);

  const host = url.searchParams.get("host");
  if (host) params.set("host", host);

  const query = params.toString();
  return `${AUTH_TOP_LEVEL_PATH}${query ? `?${query}` : ""}`;
}

export function buildTopLevelOAuthBeginUrl(
  request: Request,
  appUrl: string,
): string {
  const url = new URL(request.url);
  const params = new URLSearchParams();

  const shop = url.searchParams.get("shop");
  if (shop) params.set("shop", shop);

  const host = url.searchParams.get("host");
  if (host) params.set("host", host);

  params.set("embedded", "0");

  const flowId = readAuthFlowId(request);
  if (flowId) params.set("authFlowId", flowId);

  return `${appUrl.replace(/\/$/, "")}/auth?${params.toString()}`;
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

function buildAppBridgeTopLevelEscapeHtml(
  apiKey: string,
  topLevelAuthUrl: string,
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script data-api-key="${apiKey}" src="${APP_BRIDGE_SCRIPT_URL}"></script>
</head>
<body>
  <script>window.open(${JSON.stringify(topLevelAuthUrl)}, ${JSON.stringify("_top")})</script>
</body>
</html>`;
}

export function logOAuthEscapeBeforeBegin(
  request: Request,
  shop: string | null,
): void {
  logListingFixEvent({
    action: "auth_redirect",
    shop,
    meta: {
      event: "oauth_escape_before_begin",
      pathname: new URL(request.url).pathname,
      embedded: new URL(request.url).searchParams.get("embedded"),
      hasHost: Boolean(new URL(request.url).searchParams.get("host")),
      secFetchDest: request.headers.get("sec-fetch-dest"),
      isEmbeddedOAuthRequest: isEmbeddedOAuthRequest(request),
    },
  });
}

export function renderAuthTopLevelEscapePage(
  request: Request,
  appUrl: string,
): Response {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response("Missing shop parameter for OAuth top-level escape", {
      status: 400,
    });
  }

  logOAuthEscapeBeforeBegin(request, shop);
  logOAuthEmbeddedDetected(request, shop);
  recordAuthFlowStep(request, "oauth_escape_before_begin", {
    shop,
    pathname: url.pathname,
  });

  const topLevelAuthUrl = buildTopLevelOAuthBeginUrl(request, appUrl);
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";

  logListingFixEvent({
    action: "auth_redirect",
    shop,
    meta: {
      event: "oauth_top_level_escape_page",
      oauth_top_level_auth_url: topLevelAuthUrl,
      strategy: "app_bridge_html_before_begin",
      oauth_top_level_redirect: true,
    },
  });

  const headers = new Headers({
    "content-type": "text/html;charset=utf-8",
  });
  headers.set("Content-Security-Policy", buildEmbeddedFrameAncestorsCsp(shop));

  return new Response(
    buildAppBridgeTopLevelEscapeHtml(apiKey, topLevelAuthUrl),
    {
      status: 200,
      headers,
    },
  );
}

export function redirectEmbeddedAuthToTopLevelEscape(
  request: Request,
): never {
  logOAuthEscapeBeforeBegin(
    request,
    new URL(request.url).searchParams.get("shop"),
  );

  throw redirect(buildAuthTopLevelEscapeUrl(request));
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
