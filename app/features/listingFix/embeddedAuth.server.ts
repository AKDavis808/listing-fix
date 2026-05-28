import { redirect } from "react-router";

import { deleteShopSessions } from "./shopSessions.server";
import {
  getOfflineSessionId,
  logSessionPersistenceEvent,
  logShopSessionSnapshot,
} from "./sessionPersistence.server";
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

const DEFAULT_APP_RELOAD_PATH = "/app";
const SESSION_TOKEN_RELOAD_PRESERVED_PARAMS = [
  "embedded",
  "shop",
  "host",
  "locale",
  "session",
  "timestamp",
] as const;

function isSessionTokenReloadPath(pathname: string): boolean {
  return (
    pathname === SESSION_TOKEN_PATH ||
    pathname.endsWith(`${SESSION_TOKEN_PATH}/`)
  );
}

function buildDefaultSessionTokenReloadSearchParams(
  requestUrl: URL,
): URLSearchParams | null {
  const shop = requestUrl.searchParams.get("shop");
  const host = requestUrl.searchParams.get("host");
  if (!shop || !host) return null;

  const params = new URLSearchParams();
  params.set("embedded", requestUrl.searchParams.get("embedded") ?? "1");
  params.set("shop", shop);
  params.set("host", host);

  for (const key of SESSION_TOKEN_RELOAD_PRESERVED_PARAMS) {
    if (key === "embedded" || key === "shop" || key === "host") continue;
    const value = requestUrl.searchParams.get(key);
    if (value) params.set(key, value);
  }

  return params;
}

function sanitizeSessionTokenReloadTarget(
  rawReload: string,
  requestUrl: URL,
): { reloadUrl: string; preventedSelfReload: boolean } {
  const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);
  const base = appUrl || requestUrl.origin;
  let parsed: URL;

  try {
    parsed = new URL(rawReload, base);
  } catch {
    const fallbackParams = buildDefaultSessionTokenReloadSearchParams(requestUrl);
    const query = fallbackParams?.toString();
    return {
      reloadUrl: query
        ? `${DEFAULT_APP_RELOAD_PATH}?${query}`
        : DEFAULT_APP_RELOAD_PATH,
      preventedSelfReload: false,
    };
  }

  let preventedSelfReload = false;
  if (isSessionTokenReloadPath(parsed.pathname)) {
    parsed.pathname = DEFAULT_APP_RELOAD_PATH;
    preventedSelfReload = true;
  }

  parsed.searchParams.delete("shopify-reload");
  parsed.searchParams.delete("id_token");
  parsed.searchParams.delete("hmac");

  const sameOriginBase = new URL(base);
  if (parsed.origin === sameOriginBase.origin) {
    const query = parsed.searchParams.toString();
    return {
      reloadUrl: `${parsed.pathname}${query ? `?${query}` : ""}${parsed.hash}`,
      preventedSelfReload,
    };
  }

  return { reloadUrl: parsed.href, preventedSelfReload };
}

function resolveSessionTokenReloadTarget(request: Request): {
  reloadUrl: string | null;
  defaulted: boolean;
  preventedSelfReload: boolean;
} {
  const requestUrl = new URL(request.url);
  const rawReload = requestUrl.searchParams.get("shopify-reload");

  if (rawReload) {
    const sanitized = sanitizeSessionTokenReloadTarget(rawReload, requestUrl);
    return {
      reloadUrl: sanitized.reloadUrl,
      defaulted: false,
      preventedSelfReload: sanitized.preventedSelfReload,
    };
  }

  const defaultParams = buildDefaultSessionTokenReloadSearchParams(requestUrl);
  if (!defaultParams) {
    return {
      reloadUrl: null,
      defaulted: false,
      preventedSelfReload: false,
    };
  }

  const defaultReload = `${DEFAULT_APP_RELOAD_PATH}?${defaultParams.toString()}`;
  const sanitized = sanitizeSessionTokenReloadTarget(defaultReload, requestUrl);

  return {
    reloadUrl: sanitized.reloadUrl,
    defaulted: true,
    preventedSelfReload: sanitized.preventedSelfReload,
  };
}

export function renderSessionTokenBouncePage(request: Request): never {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";
  const oauthScopes = process.env.SCOPES?.trim() ?? "";
  const oauthInstallUrl = shop ? buildEmbeddedOAuthInstallUrl(shop) : "";
  const reloadResolution = resolveSessionTokenReloadTarget(request);
  const { reloadUrl, defaulted, preventedSelfReload } = reloadResolution;

  if (!apiKey) {
    logEmbeddedAuthEvent("session_missing", request, {
      reason: "missing_api_key",
      route: "auth.session-token",
    });
  }

  if (defaulted && reloadUrl) {
    logListingFixEvent({
      action: "auth_redirect",
      shop,
      meta: {
        event: "session_token_missing_reload_defaulted",
        reloadUrl,
        route: "auth.session-token",
      },
    });
  }

  if (preventedSelfReload && reloadUrl) {
    logListingFixEvent({
      action: "auth_redirect",
      shop,
      meta: {
        event: "session_token_self_reload_prevented",
        reloadUrl,
        route: "auth.session-token",
      },
    });
  }

  if (!reloadUrl) {
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
    hasShopifyReload: Boolean(url.searchParams.get("shopify-reload")),
    hasResolvedReload: Boolean(reloadUrl),
    reloadDefaulted: defaulted,
    reloadSelfLoopPrevented: preventedSelfReload,
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
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          Helvetica, Arial, sans-serif;
        background: #f6f6f7;
        color: #202223;
      }
      #listingfix-reconnect {
        box-sizing: border-box;
        max-width: 420px;
        margin: 48px auto;
        padding: 24px;
        background: #ffffff;
        border: 1px solid #e1e3e5;
        border-radius: 12px;
        box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05);
      }
      #listingfix-reconnect[hidden] {
        display: none;
      }
      #listingfix-reconnect h1 {
        margin: 0 0 8px;
        font-size: 20px;
        font-weight: 600;
        line-height: 1.3;
      }
      #listingfix-reconnect p {
        margin: 0 0 20px;
        font-size: 14px;
        line-height: 1.5;
        color: #6d7175;
      }
      #listingfix-reconnect-button {
        appearance: none;
        border: none;
        border-radius: 8px;
        background: #008060;
        color: #ffffff;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
        padding: 10px 16px;
      }
      #listingfix-reconnect-button:hover {
        background: #006e52;
      }
      #listingfix-reconnect-button:focus-visible {
        outline: 2px solid #005bd3;
        outline-offset: 2px;
      }
    </style>
  </head>
  <body>
    <div id="listingfix-reconnect" hidden>
      <h1>Reconnect ListingFix</h1>
      <p>Shopify needs to refresh your app connection before ListingFix can continue.</p>
      <button type="button" id="listingfix-reconnect-button">
        Reconnect in Shopify
      </button>
    </div>
    <script>
      (function () {
        var REAUTH_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";
        var RETRY_SESSION_HEADER = "X-Shopify-Retry-Invalid-Session-Request";
        var MAX_BOUNCE_RETRIES = 3;
        var pageParams = new URLSearchParams(location.search);
        var appOrigin = location.origin;
        var pendingReconnectUrl = null;
        var reloadDefaulted = ${JSON.stringify(defaulted)};
        var reloadSelfLoopPrevented = ${JSON.stringify(preventedSelfReload)};
        var shopifyReload = ${JSON.stringify(reloadUrl ?? "")};
        var oauthScopes = ${JSON.stringify(oauthScopes)};
        var oauthApiKey = ${JSON.stringify(apiKey)};
        var serverOAuthInstallUrl = ${JSON.stringify(oauthInstallUrl)};

        function buildOAuthInstallUrl(shop) {
          if (serverOAuthInstallUrl) return serverOAuthInstallUrl;
          if (!shop || !oauthApiKey) return "";
          var shopWithoutProtocol = String(shop)
            .replace(/^https?:\\/\\//, "")
            .replace(/\\/$/, "");
          var shopWithDomain =
            shopWithoutProtocol.indexOf(".") === -1
              ? shopWithoutProtocol + ".myshopify.com"
              : shopWithoutProtocol;
          var shopNameMatch = shopWithDomain.match(/^(.+)\\.myshopify\\.com$/);
          var params = new URLSearchParams({
            client_id: oauthApiKey,
          });
          if (shopNameMatch) {
            return (
              "https://admin.shopify.com/store/" +
              shopNameMatch[1] +
              "/oauth/install?" +
              params.toString()
            );
          }
          return (
            "https://" + shopWithDomain + "/admin/oauth/install?" + params.toString()
          );
        }

        function logError(reason) {
          console.log("session_token_error", reason);
        }

        function buildDefaultReloadFromPageParams() {
          var shop = pageParams.get("shop");
          var host = pageParams.get("host");
          if (!shop || !host) return "";

          var params = new URLSearchParams();
          params.set("embedded", pageParams.get("embedded") || "1");
          params.set("shop", shop);
          params.set("host", host);
          ["locale", "session", "timestamp"].forEach(function (key) {
            var value = pageParams.get(key);
            if (value) params.set(key, value);
          });

          return "/app?" + params.toString();
        }

        function sanitizeReloadTarget(rawReload) {
          if (!rawReload) return "";

          try {
            var parsed = new URL(rawReload, appOrigin);
            if (/\\/auth\\/session-token\\/?$/.test(parsed.pathname)) {
              console.log("session_token_self_reload_prevented", {
                original: rawReload,
                reloadUrl: "/app" + (parsed.search || ""),
              });
              parsed.pathname = "/app";
            }

            parsed.searchParams.delete("shopify-reload");
            parsed.searchParams.delete("id_token");
            parsed.searchParams.delete("hmac");

            if (parsed.origin === appOrigin) {
              return (
                parsed.pathname +
                (parsed.search ? parsed.search : "") +
                (parsed.hash || "")
              );
            }

            return parsed.href;
          } catch (error) {
            return rawReload;
          }
        }

        if (!shopifyReload) {
          shopifyReload = buildDefaultReloadFromPageParams();
          if (shopifyReload) {
            reloadDefaulted = true;
            console.log("session_token_missing_reload_defaulted", {
              shopifyReload: shopifyReload,
            });
          }
        }

        shopifyReload = sanitizeReloadTarget(shopifyReload);

        if (reloadDefaulted && shopifyReload) {
          console.log("session_token_missing_reload_defaulted", {
            shopifyReload: shopifyReload,
          });
        }

        if (reloadSelfLoopPrevented && shopifyReload) {
          console.log("session_token_self_reload_prevented", {
            shopifyReload: shopifyReload,
          });
        }

        function isOAuthInstallUrl(urlString) {
          try {
            var parsed = new URL(urlString, appOrigin);
            return (
              parsed.hostname === "admin.shopify.com" ||
              parsed.pathname.indexOf("/oauth/install") !== -1
            );
          } catch (error) {
            return /admin\\.shopify\\.com|oauth\\/install/.test(String(urlString));
          }
        }

        function isCrossOriginNavigationTarget(urlString) {
          try {
            var parsed = new URL(urlString, appOrigin);
            if (parsed.origin !== appOrigin) {
              return true;
            }
            if (parsed.hostname === "admin.shopify.com") {
              return true;
            }
            if (/\\.myshopify\\.com$/i.test(parsed.hostname)) {
              return true;
            }
            if (isOAuthInstallUrl(urlString)) {
              return true;
            }
            if (/oauth\\/install|oauth\\/authorize|reauthorize/i.test(
              parsed.pathname + parsed.search,
            )) {
              return true;
            }
            return false;
          } catch (error) {
            return true;
          }
        }

        function isSameOriginAppAuthPath(urlString) {
          try {
            var parsed = new URL(urlString, appOrigin);
            if (parsed.origin !== appOrigin) return false;
            return /^\\/auth\\/(login|callback|session-token)/.test(parsed.pathname);
          } catch (error) {
            return false;
          }
        }

        function navigateSameOrigin(url, reason) {
          if (isCrossOriginNavigationTarget(url)) {
            console.log("session_token_cross_origin_navigation_blocked", {
              url: url,
              reason: reason,
            });
            showReconnectPrompt(url, reason);
            return;
          }

          console.log("session_token_same_origin_redirect", {
            url: url,
            reason: reason,
          });
          window.location.assign(url);
        }

        function showReconnectPrompt(url, reason) {
          pendingReconnectUrl = url;
          console.log("session_token_oauth_redirect_detected", {
            url: url,
            reason: reason,
          });
          console.log("session_token_user_action_required", {
            url: url,
            reason: reason,
          });
          console.log("session_token_cross_origin_navigation_blocked", {
            url: url,
            reason: reason,
          });

          var panel = document.getElementById("listingfix-reconnect");
          var button = document.getElementById("listingfix-reconnect-button");
          if (!panel || !button) {
            logError("reconnect_ui_missing");
            return;
          }

          panel.hidden = false;
          button.onclick = function () {
            console.log("session_token_reconnect_clicked", pendingReconnectUrl);
            console.log("session_token_top_navigation_start", pendingReconnectUrl);
            var target =
              window.top && window.top !== window ? window.top : window;
            target.location.href = pendingReconnectUrl;
          };
        }

        function handleNavigationTarget(url, reason) {
          if (isCrossOriginNavigationTarget(url)) {
            showReconnectPrompt(url, reason);
            return;
          }

          if (isSameOriginAppAuthPath(url)) {
            navigateSameOrigin(url, reason);
            return;
          }

          navigateSameOrigin(url, reason);
        }

        function resolveNavigationTarget(response, reloadUrl) {
          var reauthUrl = response.headers.get(REAUTH_HEADER);
          if (reauthUrl) {
            return { url: reauthUrl, reason: "reauth_header" };
          }

          if (response.url && isCrossOriginNavigationTarget(response.url)) {
            return { url: response.url, reason: "response_url" };
          }

          if (response.status >= 300 && response.status < 400) {
            var locationHeader = response.headers.get("Location");
            if (locationHeader) {
              var redirectUrl = new URL(locationHeader, reloadUrl.href).href;
              if (isCrossOriginNavigationTarget(redirectUrl)) {
                return {
                  url: redirectUrl,
                  reason: "cross_origin_redirect_" + response.status,
                };
              }
              if (isSameOriginAppAuthPath(redirectUrl)) {
                return {
                  url: redirectUrl,
                  reason: "same_origin_auth_redirect_" + response.status,
                };
              }
            }
          }

          if (response.status === 401) {
            if (response.headers.get(RETRY_SESSION_HEADER)) {
              return { url: null, reason: "retry_invalid_session" };
            }
            return { url: null, reason: "unauthorized_without_reauth_url" };
          }

          if (response.type === "opaqueredirect") {
            return null;
          }

          return null;
        }

        async function writeSameOriginHtml(response, reloadUrl) {
          console.log("session_token_same_origin_html_received", {
            status: response.status,
          });

          if (document.documentElement) {
            document.documentElement.remove();
          }
          reloadUrl.searchParams.delete("shopify-reload");
          history.replaceState(
            null,
            "",
            reloadUrl.pathname +
              (reloadUrl.search ? reloadUrl.search : "") +
              reloadUrl.hash,
          );

          if (
            response.body &&
            typeof TextDecoderStream !== "undefined" &&
            typeof response.body.pipeThrough === "function"
          ) {
            var reader = response.body
              .pipeThrough(new TextDecoderStream())
              .getReader();
            for (;;) {
              var chunk = await reader.read();
              if (chunk.done) break;
              document.write(chunk.value);
            }
          } else {
            document.write(await response.text());
          }

          document.close();
        }

        async function performBounceReload(retryCount) {
          if (typeof retryCount !== "number") retryCount = 0;
          if (!shopifyReload) {
            logError("missing_shopify_reload");
            return;
          }

          if (!window.shopify || typeof window.shopify.idToken !== "function") {
            logError("shopify_id_token_unavailable");
            return;
          }

          var reloadUrl;
          try {
            reloadUrl = new URL(shopifyReload, appOrigin);
          } catch (error) {
            logError("invalid_shopify_reload");
            return;
          }

          if (reloadUrl.origin !== appOrigin) {
            logError("shopify_reload_not_same_origin");
            return;
          }

          console.log("session_token_requested", { retryCount: retryCount });
          var token;
          try {
            token = await window.shopify.idToken();
            console.log("session_token_received", { retryCount: retryCount });
          } catch (error) {
            logError(String(error));
            return;
          }

          console.log("session_token_reload_start", reloadUrl.href);

          var response;
          try {
            response = await fetch(reloadUrl.href, {
              method: "GET",
              mode: "same-origin",
              credentials: "same-origin",
              redirect: "manual",
              headers: {
                Accept: "text/html",
                Authorization: "Bearer " + token,
                "X-Shopify-Bounce": "1",
              },
            });
          } catch (error) {
            logError(String(error));
            return;
          }

          console.log("session_token_bounce_response", {
            status: response.status,
            ok: response.ok,
            type: response.type,
            url: response.url,
            retryCount: retryCount,
            retryHeader: response.headers.get(RETRY_SESSION_HEADER),
          });

          var navigationTarget = resolveNavigationTarget(response, reloadUrl);
          if (
            navigationTarget &&
            navigationTarget.reason === "retry_invalid_session" &&
            retryCount < MAX_BOUNCE_RETRIES
          ) {
            console.log("session_token_retry_invalid_session", {
              retryCount: retryCount + 1,
            });
            await new Promise(function (resolve) {
              setTimeout(resolve, 300);
            });
            return performBounceReload(retryCount + 1);
          }

          if (navigationTarget && navigationTarget.url) {
            handleNavigationTarget(
              navigationTarget.url,
              navigationTarget.reason,
            );
            return;
          }

          if (
            navigationTarget &&
            navigationTarget.reason === "unauthorized_without_reauth_url"
          ) {
            if (retryCount < MAX_BOUNCE_RETRIES) {
              console.log("session_token_auth_retry", {
                retryCount: retryCount + 1,
              });
              await new Promise(function (resolve) {
                setTimeout(resolve, 500);
              });
              return performBounceReload(retryCount + 1);
            }

            var shop = pageParams.get("shop");
            var oauthUrl = buildOAuthInstallUrl(shop);
            if (oauthUrl) {
              console.log("session_token_user_action_required", {
                url: oauthUrl,
                reason: "missing_offline_session",
                retryCount: retryCount,
              });
              showReconnectPrompt(oauthUrl, "missing_offline_session");
            } else {
              logError(navigationTarget.reason);
            }
            return;
          }

          var contentType = (response.headers.get("content-type") || "").trim();
          if (response.ok && /^text\\/html(\\s*;|$)/i.test(contentType)) {
            try {
              await writeSameOriginHtml(response, reloadUrl);
            } catch (error) {
              logError(String(error));
            }
            return;
          }

          logError("unexpected_bounce_response_" + response.status);
        }

        function startBounceReloadWhenReady() {
          var attempts = 0;
          var timer = setInterval(function () {
            attempts += 1;
            if (window.shopify && typeof window.shopify.idToken === "function") {
              clearInterval(timer);
              performBounceReload().catch(function (error) {
                logError(String(error));
              });
            } else if (attempts > 200) {
              clearInterval(timer);
              logError("shopify_global_timeout");
            }
          }, 50);
        }

        if (pageParams.get("shopify-reload")) {
          pageParams.delete("shopify-reload");
          var cleanedSearch = pageParams.toString();
          history.replaceState(
            null,
            "",
            location.pathname + (cleanedSearch ? "?" + cleanedSearch : ""),
          );
        }

        console.log("session_token_page_loaded", {
          href: location.href,
          shopifyReload: shopifyReload,
        });

        window.addEventListener("error", function (event) {
          logError(event.message || "window_error");
        });
        window.addEventListener("unhandledrejection", function (event) {
          logError(String(event.reason));
        });

        var appBridgeScript = document.getElementById("listingfix-app-bridge");
        if (appBridgeScript) {
          appBridgeScript.addEventListener("load", startBounceReloadWhenReady);
          appBridgeScript.addEventListener("error", function () {
            logError("app_bridge_script_failed");
          });
        } else {
          startBounceReloadWhenReady();
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

export async function handleEmbeddedUnauthorized(
  request: Request,
  response: Response,
): Promise<never> {
  const ctx = extractRequestContext(request);

  logListingFixEvent({
    action: "auth_401_caught",
    shop: ctx.shop,
    meta: {
      pathname: ctx.pathname,
      embedded: ctx.embedded,
      hasHost: Boolean(ctx.host),
      hasSessionTokenHeader: ctx.hasSessionTokenHeader,
      hasIdToken: ctx.hasIdToken,
    },
  });

  if (isEmbeddedSessionTokenFetch(request)) {
    if (ctx.shop) {
      const deletedCount = await deleteShopSessions(
        ctx.shop,
        "embedded_401_bounce",
      );
      logSessionPersistenceEvent("prisma_session_lookup_failed", ctx.shop, {
        event: "embedded_401_sessions_cleared",
        deletedCount,
        offlineSessionId: getOfflineSessionId(ctx.shop),
      });
    }
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
  session: { shop: string; id: string; isOnline: boolean };
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

  if (ctx.embedded && ctx.shop) {
    logSessionPersistenceEvent("offline_session_id", ctx.shop, {
      sessionId: getOfflineSessionId(ctx.shop),
    });
    await logShopSessionSnapshot(ctx.shop);
  }

  try {
    const result = await authenticateAdmin(request);
    logEmbeddedAuthEvent("session_restored", request, {
      sessionShop: result.session.shop,
      sessionId: result.session.id,
      isOnline: result.session.isOnline,
    });
    logSessionPersistenceEvent("prisma_session_lookup", result.session.shop, {
      sessionId: result.session.id,
      found: true,
      source: "authenticate_admin_success",
    });
    return result;
  } catch (error) {
    if (isUnauthorizedResponse(error)) {
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
    });

    throw redirect(redirectUrl.toString());
  }
}

// Side-effect validation on module load in production.
validateProductionShopifyEnv();
