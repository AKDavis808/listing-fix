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
const BOUNCE_REQUEST_HEADER = "X-Shopify-Bounce";
const APP_BRIDGE_URL =
  "https://cdn.shopify.com/shopifycloud/app-bridge.js";

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

function isEmbeddedSessionTokenFetch(request: Request): boolean {
  return (
    Boolean(request.headers.get("authorization")) ||
    request.headers.has(BOUNCE_REQUEST_HEADER)
  );
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderSessionTokenBouncePage(request: Request): never {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const shopifyReload = url.searchParams.get("shopify-reload");
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";

  if (!apiKey) {
    logEmbeddedAuthEvent("session_missing", request, {
      reason: "missing_api_key",
      route: "auth.session-token",
    });
  }

  if (!shopifyReload) {
    logEmbeddedAuthEvent("session_missing", request, {
      reason: "missing_shopify_reload",
      route: "auth.session-token",
    });
  }

  logEmbeddedAuthEvent("auth_redirect", request, {
    target: SESSION_TOKEN_PATH,
    source: "render_session_token_bounce",
    preservedShop: Boolean(shop),
    preservedHost: Boolean(url.searchParams.get("host")),
    hasShopifyReload: Boolean(shopifyReload),
  });

  const responseHeaders = new Headers({
    "content-type": "text/html;charset=utf-8",
    "cache-control": "no-store",
  });

  if (shop) {
    responseHeaders.set(
      "Content-Security-Policy",
      `frame-ancestors https://${shop} https://admin.shopify.com https://*.spin.dev https://admin.myshopify.io https://admin.shop.dev;`,
    );
    responseHeaders.set(
      "Link",
      `<https://cdn.shopify.com>; rel="preconnect", <${APP_BRIDGE_URL}>; rel="preload"; as="script"`,
    );
  }

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>ListingFix session token</title>
  </head>
  <body>
    <script>
      (function () {
        function logError(reason) {
          console.log("session_token_error", reason);
        }

        console.log("session_token_page_loaded", {
          href: location.href,
          shopifyReload: new URLSearchParams(location.search).get("shopify-reload"),
        });

        window.addEventListener("error", function (event) {
          logError(event.message || "window_error");
        });
        window.addEventListener("unhandledrejection", function (event) {
          logError(String(event.reason));
        });

        function installFetchLogging() {
          var originalFetch = window.fetch;
          if (!originalFetch) return;

          window.fetch = function (input, init) {
            var requestInit = init || {};
            var headers = requestInit.headers;
            var headerLookup = function (name) {
              if (!headers) return null;
              if (typeof headers.get === "function") return headers.get(name);
              return headers[name] || headers[name.toLowerCase()] || null;
            };

            if (headerLookup("Authorization")) {
              console.log("session_token_requested");
            }
            if (headerLookup("X-Shopify-Bounce")) {
              console.log("session_token_reload_start", String(input));
            }

            return originalFetch.call(this, input, init).then(
              function (response) {
                if (headerLookup("X-Shopify-Bounce")) {
                  console.log("session_token_received", {
                    status: response.status,
                    ok: response.ok,
                  });
                }
                return response;
              },
              function (error) {
                logError(String(error));
                throw error;
              },
            );
          };
        }

        installFetchLogging();

        var appBridgeScript = document.getElementById("listingfix-app-bridge");
        if (appBridgeScript) {
          appBridgeScript.addEventListener("load", installFetchLogging);
          appBridgeScript.addEventListener("error", function () {
            logError("app_bridge_script_failed");
          });
        }
      })();
    </script>
    <script
      id="listingfix-app-bridge"
      data-api-key="${escapeHtmlAttribute(apiKey)}"
      src="${APP_BRIDGE_URL}"
    ></script>
  </body>
</html>`;

  throw new Response(html, { headers: responseHeaders });
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

  // App Bridge bounce fetches /app with Authorization + X-Shopify-Bounce.
  // Redirecting those 401s back to /auth/session-token breaks document.write reload.
  if (
    ctx.embedded &&
    ctx.shop &&
    ctx.host &&
    !isEmbeddedSessionTokenFetch(request)
  ) {
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
