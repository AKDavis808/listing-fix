import { redirect } from "react-router";

import { isEmbeddedOAuthContext } from "./oauthCookiePolicy.server";
import { logListingFixEvent } from "./telemetry";

const OAUTH_IN_PROGRESS_COOKIE = "listingfix_oauth_in_progress";
const EXIT_IFRAME_PATH = "/auth/exit-iframe";

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

export function logOAuthTopLevelRedirect(
  request: Request,
  shop: string | null,
  authorizeUrl: string,
  exitIframeUrl: string,
): void {
  logListingFixEvent({
    action: "auth_redirect",
    shop,
    meta: {
      event: "oauth_top_level_redirect",
      escaped_iframe_for_oauth: true,
      auth_response_location: authorizeUrl,
      exitIframeUrl,
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

export function escapeEmbeddedOAuthBegin(
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

  const exitParams = new URLSearchParams({
    shop,
    host,
    exitIframe: authorizeUrl,
  });

  const exitIframeUrl = `${EXIT_IFRAME_PATH}?${exitParams.toString()}`;

  logOAuthTopLevelRedirect(request, shop, authorizeUrl, exitIframeUrl);

  const headers = new Headers();
  copySetCookieHeaders(beginResponse.headers, headers);
  headers.append("set-cookie", buildOAuthInProgressCookie());

  throw redirect(exitIframeUrl, { headers });
}

export function shouldEscapeEmbeddedOAuthBegin(request: Request): boolean {
  return (
    isEmbeddedOAuthContext(request) &&
    new URL(request.url).searchParams.get("embedded") === "1" &&
    Boolean(new URL(request.url).searchParams.get("host"))
  );
}

export function appendClearOAuthInProgressCookie(headers: Headers): void {
  headers.append("set-cookie", buildClearOAuthInProgressCookie());
}

export function logExitIframeRouteEntered(request: Request): void {
  const url = new URL(request.url);

  logListingFixEvent({
    action: "oauth_start",
    shop: url.searchParams.get("shop"),
    meta: {
      event: "escaped_iframe_for_oauth",
      pathname: url.pathname,
      auth_response_location: url.searchParams.get("exitIframe"),
      hasExitIframeParam: Boolean(url.searchParams.get("exitIframe")),
    },
  });
}
