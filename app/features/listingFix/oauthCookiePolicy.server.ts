import { normalizeShopifyAppUrl } from "./embeddedAuth.server";
import { rememberOAuthBeginCookies } from "./oauthBeginCookieSnapshot.server";
import {
  appendSetCookieHeaders,
  extractSetCookieHeaders,
} from "./setCookieHeaders.server";
import { logListingFixEvent } from "./telemetry";

const STATE_COOKIE_NAME = "shopify_app_state";
const SHOPIFY_STATE_SIG_COOKIE = `${STATE_COOKIE_NAME}.sig`;

export const EMBEDDED_OAUTH_COOKIE_SAME_SITE = "none" as const;
export const EMBEDDED_OAUTH_COOKIE_PATH = "/" as const;

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
      oauth_cookie_path: EMBEDDED_OAUTH_COOKIE_PATH,
      httpsProductionApp: isHttpsProductionApp(),
      shopifyAppUrl: appUrl || null,
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
  });
}

function getSetCookieHeaders(headers: Headers): string[] {
  return extractSetCookieHeaders(headers);
}

export type EmbeddedOAuthCookiePolicyResult = {
  response: Response;
  setCookies: string[];
};

export function applyEmbeddedOAuthCookiePolicy(
  response: Response,
  request: Request,
): EmbeddedOAuthCookiePolicyResult {
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
    return {
      response,
      setCookies: extractSetCookieHeaders(response.headers),
    };
  }

  const originalCookies = getSetCookieHeaders(response.headers);
  if (originalCookies.length === 0) {
    return { response, setCookies: [] };
  }

  const rewrittenCookies = originalCookies.map((cookie) =>
    rewriteEmbeddedOAuthCookie(cookie),
  );

  const headers = new Headers();
  response.headers.forEach((value, key) => {
    headers.append(key, value);
  });
  appendSetCookieHeaders(headers, rewrittenCookies);

  const stateCookie = rewrittenCookies.find((cookie) =>
    cookie.startsWith(`${STATE_COOKIE_NAME}=`),
  );

  const originalStateCookie = originalCookies.find((cookie) =>
    cookie.startsWith(`${STATE_COOKIE_NAME}=`),
  );

  const shop = new URL(request.url).searchParams.get("shop");
  if (shop) {
    rememberOAuthBeginCookies(shop, rewrittenCookies);
  }

  logListingFixEvent({
    action: "oauth_start",
    shop: new URL(request.url).searchParams.get("shop"),
    meta: {
      event: "oauth_cookie_policy_applied",
      oauth_cookie_samesite: EMBEDDED_OAUTH_COOKIE_SAME_SITE,
      oauth_cookie_secure: true,
      oauth_cookie_path: EMBEDDED_OAUTH_COOKIE_PATH,
      originalSetCookiePath: originalStateCookie
        ? extractCookiePath(originalStateCookie)
        : null,
      rewrittenSetCookiePath: stateCookie ? extractCookiePath(stateCookie) : null,
      embedded: isEmbeddedOAuthContext(request),
      httpsProductionApp: isHttpsProductionApp(),
      stateCookieRewritten: Boolean(stateCookie),
      setCookieCount: rewrittenCookies.length,
    },
  });

  return {
    response: new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    setCookies: rewrittenCookies,
  };
}

function extractCookiePath(setCookie: string): string | null {
  const match = setCookie.match(/;\s*Path=([^;]+)/i);
  return match?.[1]?.trim() ?? null;
}

function rewriteEmbeddedOAuthCookie(setCookie: string): string {
  let cookie = setCookie;

  if (/;\s*Path=/i.test(cookie)) {
    cookie = cookie.replace(/;\s*Path=[^;]*/gi, "; Path=/");
  } else {
    cookie = `${cookie}; Path=/`;
  }

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
      callback_cookie_names: cookieNames.join(","),
      callback_state_sig_present: cookieNames.includes(SHOPIFY_STATE_SIG_COOKIE),
      oauth_cookie_samesite: EMBEDDED_OAUTH_COOKIE_SAME_SITE,
      oauth_cookie_secure: true,
      oauth_cookie_path: EMBEDDED_OAUTH_COOKIE_PATH,
      cookieHeaderPresent: Boolean(cookieHeader),
      stateCookiePresent: cookieNames.includes(STATE_COOKIE_NAME),
      cookieNames: cookieNames.join(","),
    },
  });
}

export { STATE_COOKIE_NAME };
