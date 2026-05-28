import { redirect } from "react-router";

import { isAuthDebugEnabled } from "./authDebugEnv.server";
import { readAuthFlowId, recordAuthFlowStep } from "./authFlowTelemetry.server";

const OAUTH_IN_PROGRESS_COOKIE = "listingfix_oauth_in_progress";
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

  if (isAuthDebugEnabled()) {
    const flowId = readAuthFlowId(request);
    if (flowId) params.set("authFlowId", flowId);
  }

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

  recordAuthFlowStep(request, "oauth_escape_before_begin", {
    shop,
    pathname: url.pathname,
  });

  const topLevelAuthUrl = buildTopLevelOAuthBeginUrl(request, appUrl);
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";

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
  throw redirect(buildAuthTopLevelEscapeUrl(request));
}

export function appendClearOAuthInProgressCookie(headers: Headers): void {
  headers.append("set-cookie", buildClearOAuthInProgressCookie());
}

export function logOAuthInProgressSkip(_request: Request, _shop: string | null): void {
  // Reserved for auth debug tooling only.
}

export function logOAuthEmbeddedDetected(
  _request: Request,
  _shop: string | null,
): void {
  // Reserved for auth debug tooling only.
}

export function logExitIframeRouteEntered(_request: Request): void {
  // Reserved for auth debug tooling only.
}
