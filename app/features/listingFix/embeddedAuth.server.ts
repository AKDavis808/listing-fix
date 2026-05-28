import { redirect } from "react-router";

import { logAuthDiagnosticOnce } from "./authDiagnostics.server";
import { logOfflineSessionMissingOnce } from "./sessionPersistence.server";
import { logListingFixEvent } from "./telemetry";

export type EmbeddedAuthEvent =
  | "iframe_request"
  | "embedded_detected"
  | "auth_redirect"
  | "oauth_start"
  | "oauth_complete"
  | "session_restored"
  | "session_missing";

type AuthLogMeta = Record<string, string | number | boolean | null | undefined>;

const LOGIN_PATH = "/auth/login";
const REAUTH_URL_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";
const BOUNCE_REQUEST_HEADER = "X-Shopify-Bounce";

function extractRequestContext(request: Request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const host = url.searchParams.get("host");
  const embedded = url.searchParams.get("embedded") === "1";
  const hasSessionTokenHeader = Boolean(request.headers.get("authorization"));
  const hasIdToken = Boolean(url.searchParams.get("id_token"));

  return {
    pathname: url.pathname,
    shop,
    host,
    embedded,
    hasSessionTokenHeader,
    hasIdToken,
    method: request.method,
    authRequestType: embedded
      ? hasSessionTokenHeader
        ? "embedded_bearer"
        : hasIdToken
          ? "embedded_document"
          : "embedded"
      : "document",
  };
}

export function logEmbeddedAuthEvent(
  action: EmbeddedAuthEvent,
  request: Request,
  meta?: AuthLogMeta,
) {
  const ctx = extractRequestContext(request);
  logListingFixEvent({
    action,
    shop: ctx.shop,
    meta: {
      pathname: ctx.pathname,
      method: ctx.method,
      embedded: ctx.embedded,
      authRequestType: ctx.authRequestType,
      hasHost: Boolean(ctx.host),
      hasSessionTokenHeader: ctx.hasSessionTokenHeader,
      hasIdToken: ctx.hasIdToken,
      ...meta,
    },
  });
}

export function normalizeShopifyAppUrl(raw: string | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/\/$/, "");
}

function isUnauthorizedResponse(error: unknown): error is Response {
  return error instanceof Response && error.status === 401;
}

function isEmbeddedSessionTokenFetch(request: Request): boolean {
  return (
    Boolean(request.headers.get("authorization")) ||
    request.headers.has(BOUNCE_REQUEST_HEADER)
  );
}

export function buildEmbeddedOAuthInstallUrl(shop: string): string {
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";
  const shopWithoutProtocol = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const shopWithDomain =
    shopWithoutProtocol.indexOf(".") === -1
      ? `${shopWithoutProtocol}.myshopify.com`
      : shopWithoutProtocol;

  const shopNameMatch = shopWithDomain.match(/^(.+)\.myshopify\.com$/);
  if (shopNameMatch) {
    const params = new URLSearchParams({ client_id: apiKey });
    return `https://admin.shopify.com/store/${shopNameMatch[1]}/oauth/install?${params.toString()}`;
  }

  const params = new URLSearchParams({ client_id: apiKey });
  return `https://${shopWithDomain}/admin/oauth/install?${params.toString()}`;
}

export async function handleEmbeddedUnauthorized(
  request: Request,
  response: Response,
): Promise<never> {
  const ctx = extractRequestContext(request);

  logAuthDiagnosticOnce("auth_401_caught", () => {
    logListingFixEvent({
      action: "auth_401_caught",
      shop: ctx.shop,
      meta: {
        pathname: ctx.pathname,
        embedded: ctx.embedded,
        authRequestType: ctx.authRequestType,
        hasHost: Boolean(ctx.host),
        hasSessionTokenHeader: ctx.hasSessionTokenHeader,
        hasIdToken: ctx.hasIdToken,
        bounce: isEmbeddedSessionTokenFetch(request),
        authRedirectReason: isEmbeddedSessionTokenFetch(request)
          ? "pass_through_bounce_401"
          : "embedded_recovery",
      },
    });
  });

  if (isEmbeddedSessionTokenFetch(request)) {
    throw response;
  }

  if (
    ctx.embedded &&
    ctx.shop &&
    (ctx.hasSessionTokenHeader || ctx.hasIdToken)
  ) {
    logListingFixEvent({
      action: "session_missing",
      shop: ctx.shop,
      meta: {
        event: "embedded_session_missing_offline_session",
        pathname: ctx.pathname,
        hasHost: Boolean(ctx.host),
      },
    });
  }

  const reauthUrl = response.headers.get(REAUTH_URL_HEADER);
  if (reauthUrl && ctx.embedded && ctx.shop) {
    logListingFixEvent({
      action: "auth_redirect_preserved",
      shop: ctx.shop,
      meta: {
        source: "reauth_url_header",
        target: LOGIN_PATH,
        reauthUrl,
        authRedirectReason: "reauth_url_header",
      },
    });
    redirectToLoginWithEmbeddedContext(request);
  }

  if (reauthUrl) {
    const requestUrl = new URL(request.url);
    const target = new URL(reauthUrl, requestUrl.origin);

    if (ctx.host) target.searchParams.set("host", ctx.host);
    if (ctx.embedded) target.searchParams.set("embedded", "1");
    if (ctx.shop && !target.searchParams.has("shop")) {
      target.searchParams.set("shop", ctx.shop);
    }

    logListingFixEvent({
      action: "auth_redirect_preserved",
      shop: ctx.shop,
      meta: {
        source: "reauth_url_header",
        target: target.pathname,
        authRedirectReason: "reauth_url_header",
      },
    });

    throw redirect(target.toString());
  }

  if (ctx.embedded && ctx.shop) {
    redirectToLoginWithEmbeddedContext(request);
  }

  throw response;
}

function isRedirectResponse(error: unknown): error is Response {
  return (
    error instanceof Response &&
    error.status >= 300 &&
    error.status < 400
  );
}

function isLoginRedirect(response: Response): boolean {
  const location = response.headers.get("Location");
  if (!location) return false;
  try {
    const url = new URL(location, "https://placeholder.local");
    return url.pathname.endsWith(LOGIN_PATH);
  } catch {
    return location.includes(LOGIN_PATH);
  }
}

export function redirectToLoginWithEmbeddedContext(
  request: Request,
): never {
  const url = new URL(request.url);
  const params = new URLSearchParams();

  const shop = url.searchParams.get("shop");
  const host = url.searchParams.get("host");
  const embedded = url.searchParams.get("embedded");

  if (shop) params.set("shop", shop);
  if (host) params.set("host", host);
  if (embedded) params.set("embedded", embedded);

  logEmbeddedAuthEvent("auth_redirect", request, {
    target: LOGIN_PATH,
    preservedShop: Boolean(shop),
    preservedHost: Boolean(host),
    authRedirectReason: "embedded_login_recovery",
  });

  logListingFixEvent({
    action: "auth_redirect_preserved",
    shop,
    meta: {
      target: LOGIN_PATH,
      preservedShop: Boolean(shop),
      preservedHost: Boolean(host),
      authRedirectReason: "embedded_login_recovery",
    },
  });

  const query = params.toString();
  throw redirect(`${LOGIN_PATH}${query ? `?${query}` : ""}`);
}

type AdminAuthResult = {
  session: { shop: string; id: string; isOnline: boolean };
};

export async function authenticateEmbeddedAdmin<T extends AdminAuthResult>(
  request: Request,
  authenticateAdmin: (request: Request) => Promise<T>,
): Promise<T> {
  const ctx = extractRequestContext(request);

  logAuthDiagnosticOnce(
    `auth_request:${ctx.pathname}:${ctx.shop ?? "unknown"}:${ctx.authRequestType}`,
    () => {
      logEmbeddedAuthEvent("iframe_request", request);
      if (ctx.embedded) {
        logEmbeddedAuthEvent("embedded_detected", request);
      }
    },
  );

  try {
    const result = await authenticateAdmin(request);
    logAuthDiagnosticOnce(`session_restored:${result.session.shop}`, () => {
      logEmbeddedAuthEvent("session_restored", request, {
        sessionShop: result.session.shop,
        sessionId: result.session.id,
        isOnline: result.session.isOnline,
      });
    });
    return result;
  } catch (error) {
    if (isUnauthorizedResponse(error)) {
      if (ctx.shop) {
        logOfflineSessionMissingOnce(ctx.shop);
      }
      await handleEmbeddedUnauthorized(request, error);
    }
    if (isRedirectResponse(error) && isLoginRedirect(error)) {
      redirectToLoginWithEmbeddedContext(request);
    }
    throw error;
  }
}

export function buildEmbeddedAppPath(
  pathname: string,
  search: string,
): string {
  if (!search) return pathname;
  return `${pathname}${search.startsWith("?") ? search : `?${search}`}`;
}

export function isEmbeddedLoginRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.searchParams.get("embedded") === "1";
}

export function hasShopParam(request: Request): boolean {
  const url = new URL(request.url);
  return Boolean(url.searchParams.get("shop"));
}

export async function loginWithEmbeddedContext(
  request: Request,
  loginFn: (request: Request) => Promise<unknown>,
): Promise<unknown> {
  try {
    return await loginFn(request);
  } catch (error) {
    if (!isRedirectResponse(error)) {
      throw error;
    }

    const location = error.headers.get("Location");
    if (!location) {
      throw error;
    }

    const requestUrl = new URL(request.url);
    const host = requestUrl.searchParams.get("host");
    const embedded = requestUrl.searchParams.get("embedded");

    if (!host && !embedded) {
      throw error;
    }

    const redirectUrl = new URL(location, requestUrl.origin);
    if (host) redirectUrl.searchParams.set("host", host);
    if (embedded) redirectUrl.searchParams.set("embedded", embedded);

    logEmbeddedAuthEvent("auth_redirect", request, {
      target: redirectUrl.pathname,
      preservedHost: Boolean(host),
      preservedEmbedded: Boolean(embedded),
      source: "login",
      authRedirectReason: "shopify_login_redirect",
    });

    throw redirect(redirectUrl.toString());
  }
}
