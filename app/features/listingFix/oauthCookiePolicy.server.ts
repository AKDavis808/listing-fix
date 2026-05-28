import { normalizeShopifyAppUrl } from "./embeddedAuth.server";
import { logListingFixEvent } from "./telemetry";

const STATE_COOKIE_NAME = "shopify_app_state";
const SHOPIFY_STATE_SIG_COOKIE = `${STATE_COOKIE_NAME}.sig`;

export const EMBEDDED_OAUTH_COOKIE_SAME_SITE = "none" as const;

const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);

export function isHttpsProductionApp(): boolean {
  return (
    appUrl.startsWith("https://") &&
    (process.env.NODE_ENV ?? "development") === "production"
  );
}

export function isEmbeddedOAuthContext(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.searchParams.get("embedded") === "1" ||
    Boolean(url.searchParams.get("host"))
  );
}

export function shouldUseEmbeddedOAuthCookiePolicy(request: Request): boolean {
  return isEmbeddedOAuthContext(request) || isHttpsProductionApp();
}

export function logOAuthCookiePolicyStartup(): void {
  logListingFixEvent({
    action: "session_restored",
    meta: {
      event: "oauth_cookie_policy_startup",
      oauth_cookie_samesite: EMBEDDED_OAUTH_COOKIE_SAME_SITE,
      oauth_cookie_secure: true,
      httpsProductionApp: isHttpsProductionApp(),
      shopifyAppUrl: appUrl || null,
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
  });
}

function getSetCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function rewriteOAuthStateCookie(setCookie: string): string {
  let cookie = setCookie;

  cookie = cookie.replace(/SameSite=Lax/gi, "SameSite=None");
  cookie = cookie.replace(/SameSite=Strict/gi, "SameSite=None");

  if (!/SameSite=/i.test(cookie)) {
    cookie = `${cookie}; SameSite=None`;
  }

  if (!/;\s*Secure(?:;|$)/i.test(cookie) && !/^Secure(?:;|$)/i.test(cookie)) {
    cookie = `${cookie}; Secure`;
  }

  return cookie;
}

function isOAuthStateCookie(setCookie: string): boolean {
  return (
    setCookie.startsWith(`${STATE_COOKIE_NAME}=`) ||
    setCookie.startsWith(`${SHOPIFY_STATE_SIG_COOKIE}=`)
  );
}

export function applyEmbeddedOAuthCookiePolicy(
  response: Response,
  request: Request,
): Response {
  if (!shouldUseEmbeddedOAuthCookiePolicy(request)) {
    logListingFixEvent({
      action: "oauth_start",
      shop: new URL(request.url).searchParams.get("shop"),
      meta: {
        event: "oauth_cookie_policy_skipped",
        oauth_cookie_samesite: "lax",
        oauth_cookie_secure: isHttpsProductionApp(),
        reason: "non_embedded_non_production_context",
      },
    });
    return response;
  }

  const originalCookies = getSetCookieHeaders(response.headers);
  if (originalCookies.length === 0) {
    return response;
  }

  const rewrittenCookies = originalCookies.map((cookie) =>
    isOAuthStateCookie(cookie) ? rewriteOAuthStateCookie(cookie) : cookie,
  );

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of rewrittenCookies) {
    headers.append("set-cookie", cookie);
  }

  const stateCookie = rewrittenCookies.find((cookie) =>
    cookie.startsWith(`${STATE_COOKIE_NAME}=`),
  );

  logListingFixEvent({
    action: "oauth_start",
    shop: new URL(request.url).searchParams.get("shop"),
    meta: {
      event: "oauth_cookie_policy_applied",
      oauth_cookie_samesite: EMBEDDED_OAUTH_COOKIE_SAME_SITE,
      oauth_cookie_secure: true,
      embedded: isEmbeddedOAuthContext(request),
      httpsProductionApp: isHttpsProductionApp(),
      stateCookieRewritten: Boolean(stateCookie),
      setCookieCount: rewrittenCookies.length,
    },
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function logCallbackCookiePresence(request: Request): void {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieNames = cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter(Boolean);

  logListingFixEvent({
    action: "oauth_start",
    shop: new URL(request.url).searchParams.get("shop"),
    meta: {
      event: "callback_cookie_present",
      callback_cookie_present: cookieNames.includes(STATE_COOKIE_NAME),
      callback_state_sig_present: cookieNames.includes(SHOPIFY_STATE_SIG_COOKIE),
      oauth_cookie_samesite: EMBEDDED_OAUTH_COOKIE_SAME_SITE,
      oauth_cookie_secure: true,
      cookieHeaderPresent: Boolean(cookieHeader),
      cookieNames: cookieNames.join(","),
    },
  });
}

export { STATE_COOKIE_NAME };
