import { redirect } from "react-router";

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
const SESSION_TOKEN_PATH = "/auth/session-token";
const REAUTH_URL_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";

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

export function validateProductionShopifyEnv(): void {
  const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";
  const apiSecret = process.env.SHOPIFY_API_SECRET?.trim() ?? "";
  const scopes = process.env.SCOPES?.trim() ?? "";

  if (!appUrl) {
    console.error("[ListingFix][session_missing] SHOPIFY_APP_URL is not set.");
    return;
  }

  if (/trycloudflare|cloudflare\.com|ngrok|localhost(?!\.)/i.test(appUrl)) {
    console.warn(
      "[ListingFix][auth_redirect] SHOPIFY_APP_URL looks non-production:",
      appUrl,
    );
  }

  if (!apiKey || !apiSecret) {
    console.error(
      "[ListingFix][session_missing] Shopify API credentials are incomplete.",
    );
  }

  console.info("[ListingFix][session_restored] Shopify env snapshot", {
    appUrl,
    hasApiKey: Boolean(apiKey),
    hasApiSecret: Boolean(apiSecret),
    scopesConfigured: Boolean(scopes),
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
}

function isUnauthorizedResponse(error: unknown): error is Response {
  return error instanceof Response && error.status === 401;
}

export function redirectToSessionTokenBounce(request: Request): never {
  const url = new URL(request.url);
  const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);
  const params = new URLSearchParams(url.searchParams);
  params.delete("id_token");

  const reloadParams = new URLSearchParams(url.searchParams);
  reloadParams.delete("id_token");

  params.set(
    "shopify-reload",
    `${appUrl}${url.pathname}?${reloadParams.toString()}`,
  );

  logEmbeddedAuthEvent("auth_redirect", request, {
    target: SESSION_TOKEN_PATH,
    source: "session_token_bounce",
    preservedShop: Boolean(url.searchParams.get("shop")),
    preservedHost: Boolean(url.searchParams.get("host")),
  });

  logListingFixEvent({
    action: "auth_redirect_preserved",
    shop: url.searchParams.get("shop"),
    meta: {
      target: SESSION_TOKEN_PATH,
      preservedShop: Boolean(url.searchParams.get("shop")),
      preservedHost: Boolean(url.searchParams.get("host")),
    },
  });

  throw redirect(`${SESSION_TOKEN_PATH}?${params.toString()}`);
}

export function handleEmbeddedUnauthorized(
  request: Request,
  response: Response,
): never {
  const ctx = extractRequestContext(request);

  logListingFixEvent({
    action: "auth_401_caught",
    shop: ctx.shop,
    meta: {
      pathname: ctx.pathname,
      embedded: ctx.embedded,
      hasHost: Boolean(ctx.host),
      hasSessionTokenHeader: ctx.hasSessionTokenHeader,
    },
  });

  const reauthUrl = response.headers.get(REAUTH_URL_HEADER);
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
      },
    });

    throw redirect(target.toString());
  }

  if (ctx.embedded && ctx.shop && ctx.host) {
    redirectToSessionTokenBounce(request);
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
  });

  logListingFixEvent({
    action: "auth_redirect_preserved",
    shop,
    meta: {
      target: LOGIN_PATH,
      preservedShop: Boolean(shop),
      preservedHost: Boolean(host),
    },
  });

  const query = params.toString();
  throw redirect(`${LOGIN_PATH}${query ? `?${query}` : ""}`);
}

type AdminAuthResult = {
  session: { shop: string };
};

export async function authenticateEmbeddedAdmin<T extends AdminAuthResult>(
  request: Request,
  authenticateAdmin: (request: Request) => Promise<T>,
): Promise<T> {
  const ctx = extractRequestContext(request);

  logEmbeddedAuthEvent("iframe_request", request);

  if (ctx.embedded) {
    logEmbeddedAuthEvent("embedded_detected", request);
  }

  if (ctx.embedded && (!ctx.shop || !ctx.host)) {
    logEmbeddedAuthEvent("session_missing", request, {
      reason: "missing_shop_or_host",
    });
  }

  try {
    const result = await authenticateAdmin(request);
    logEmbeddedAuthEvent("session_restored", request, {
      sessionShop: result.session.shop,
    });
    return result;
  } catch (error) {
    if (isUnauthorizedResponse(error)) {
      handleEmbeddedUnauthorized(request, error);
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
    });

    throw redirect(redirectUrl.toString());
  }
}

// Side-effect validation on module load in production.
validateProductionShopifyEnv();
