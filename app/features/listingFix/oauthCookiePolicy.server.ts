import { normalizeShopifyAppUrl } from "./embeddedAuth.server";
import { rememberOAuthBeginCookies } from "./oauthBeginCookieSnapshot.server";
import {
  appendSetCookieHeaders,
  extractSetCookieHeaders,
} from "./setCookieHeaders.server";

const STATE_COOKIE_NAME = "shopify_app_state";
const SHOPIFY_STATE_SIG_COOKIE = `${STATE_COOKIE_NAME}.sig`;
const OAUTH_STATE_CLEAR_PATHS = ["/", "/auth", "/auth/callback"] as const;

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

  if (url.searchParams.get("embedded") === "0") {
    return false;
  }

  return (
    url.searchParams.get("embedded") === "1" ||
    Boolean(url.searchParams.get("host"))
  );
}

export function shouldUseEmbeddedOAuthCookiePolicy(request: Request): boolean {
  return isEmbeddedOAuthContext(request) || isHttpsProductionApp();
}

export function logOAuthCookiePolicyStartup(): void {
  // Startup cookie policy is applied silently in production.
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

  const headers = copyResponseHeadersWithoutSetCookie(response);
  appendSetCookieHeaders(headers, [
    ...buildOAuthStateClearanceCookies(),
    ...rewrittenCookies,
  ]);

  const shop = new URL(request.url).searchParams.get("shop");
  if (shop) {
    rememberOAuthBeginCookies(shop, rewrittenCookies);
  }

  return {
    response: new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    setCookies: rewrittenCookies,
  };
}

function copyResponseHeadersWithoutSetCookie(response: Response): Headers {
  const headers = new Headers();

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      return;
    }

    headers.append(key, value);
  });

  return headers;
}

function buildOAuthStateClearanceCookie(name: string, path: string): string {
  return `${name}=; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=None`;
}

export function buildOAuthStateClearanceCookies(): string[] {
  return [STATE_COOKIE_NAME, SHOPIFY_STATE_SIG_COOKIE].flatMap((name) =>
    OAUTH_STATE_CLEAR_PATHS.map((path) =>
      buildOAuthStateClearanceCookie(name, path),
    ),
  );
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

export function logCallbackCookiePresence(_request: Request): void {
  // Reserved for auth debug tooling only.
}

export { STATE_COOKIE_NAME };
