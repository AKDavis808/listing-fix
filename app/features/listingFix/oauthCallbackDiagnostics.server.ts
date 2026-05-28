import {
  CookieNotFound,
  InvalidHmacError,
  InvalidOAuthError,
  ShopifyError,
} from "@shopify/shopify-api";

import {
  applyEmbeddedOAuthCookiePolicy,
  logCallbackCookiePresence,
  STATE_COOKIE_NAME,
} from "./oauthCookiePolicy.server";
import { logListingFixEvent, sanitizeErrorMessage } from "./telemetry";

const EXPECTED_PRODUCTION_APP_URL =
  "https://listing-fix-production.up.railway.app";
const EXPECTED_CALLBACK_PATH = "/auth/callback";
const EXPECTED_REDIRECT_URL = `${EXPECTED_PRODUCTION_APP_URL}${EXPECTED_CALLBACK_PATH}`;

export function logStartupUrlConfigDiagnostic(
  appUrl: string,
  authCallbackPath: string,
  apiKey: string,
  scopes: string[] | undefined,
): void {
  const computedRedirectUri = appUrl
    ? `${appUrl.replace(/\/$/, "")}${authCallbackPath}`
    : "";
  const hostEnv = process.env.HOST?.trim();
  const normalizedAppUrl = appUrl.replace(/\/$/, "");

  logListingFixEvent({
    action: "session_restored",
    meta: {
      event: "startup_url_config",
      shopifyAppUrl: normalizedAppUrl || null,
      expectedAppUrl: EXPECTED_PRODUCTION_APP_URL,
      appUrlMatchesExpected:
        normalizedAppUrl === EXPECTED_PRODUCTION_APP_URL,
      computedRedirectUri,
      expectedRedirectUrl: EXPECTED_REDIRECT_URL,
      redirectUriMatchesExpected:
        computedRedirectUri === EXPECTED_REDIRECT_URL,
      authCallbackPath,
      httpsOnly: normalizedAppUrl.startsWith("https://"),
      hostEnvPresent: Boolean(hostEnv),
      hostEnvMatchesAppUrl: hostEnv
        ? hostEnv.replace(/\/$/, "") === normalizedAppUrl
        : null,
      hasApiKey: Boolean(apiKey),
      apiKeyLength: apiKey.length,
      scopes: scopes?.join(",") ?? null,
      partnerAllowedRedirectUrls: [
        EXPECTED_REDIRECT_URL,
        `${EXPECTED_PRODUCTION_APP_URL}/auth/shopify/callback`,
      ],
    },
  });
}

function getCookieNames(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];

  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter(Boolean);
}

export function logOAuthCallbackQuery(request: Request): void {
  logCallbackCookiePresence(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const hmac = url.searchParams.get("hmac");
  const timestamp = url.searchParams.get("timestamp");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");
  const cookieHeader = request.headers.get("cookie");
  const cookieNames = getCookieNames(cookieHeader);

  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "oauth_callback_query",
      pathname: url.pathname,
      queryStringPresent: Boolean(url.search),
      oauth_callback_shop_present: Boolean(shop),
      oauth_callback_code_present: Boolean(code),
      oauth_callback_state_present: Boolean(state),
      oauth_callback_hmac_present: Boolean(hmac),
      oauth_callback_timestamp_present: Boolean(timestamp),
      oauth_callback_error_present: Boolean(oauthError),
      oauthError,
      oauthErrorDescription,
      cookieHeaderPresent: Boolean(cookieHeader),
      stateCookiePresent: cookieNames.includes(STATE_COOKIE_NAME),
      callback_cookie_present: cookieNames.includes(STATE_COOKIE_NAME),
      oauth_cookie_samesite: "none",
      oauth_cookie_secure: true,
      cookieNames: cookieNames.join(","),
      referer: request.headers.get("referer") ?? null,
      userAgentPresent: Boolean(request.headers.get("user-agent")),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    },
  });
}

export function logOAuthCallbackEnteredDetailed(
  shop: string | null,
  route: string,
): void {
  logListingFixEvent({
    action: "oauth_start",
    shop,
    meta: {
      event: "oauth_callback_entered",
      route,
    },
  });
}

export function logOAuthBeginResponse(
  request: Request,
  response: Response,
  redirectUri: string,
  callbackPath: string,
): void {
  const url = new URL(request.url);
  const setCookie = response.headers.get("set-cookie");
  const location = response.headers.get("location");

  logListingFixEvent({
    action: "oauth_start",
    shop: url.searchParams.get("shop"),
    meta: {
      event: "oauth_begin_response",
      status: response.status,
      redirectUri,
      callbackPath,
      auth_response_location: location,
      locationPresent: Boolean(location),
      locationHost: location ? safeUrlHost(location) : null,
      setCookiePresent: Boolean(setCookie),
      setCookieHasStateCookie: setCookie?.includes(STATE_COOKIE_NAME) ?? false,
      setCookieSameSite: extractCookieAttribute(setCookie, "SameSite"),
      setCookieSecure: extractCookieAttribute(setCookie, "Secure"),
      oauth_cookie_samesite: extractCookieAttribute(setCookie, "SameSite"),
      oauth_cookie_secure: extractCookieAttribute(setCookie, "Secure"),
      setCookiePath: extractCookieAttribute(setCookie, "Path"),
      embedded: url.searchParams.get("embedded") === "1",
      hasHost: Boolean(url.searchParams.get("host")),
    },
  });
}

export function logOAuthCallbackValidationSuccess(shop: string): void {
  logListingFixEvent({
    action: "oauth_complete",
    shop,
    meta: {
      event: "oauth_callback_validation_success",
    },
  });
}

export function classifyOAuthCallbackError(error: unknown): string {
  if (error instanceof CookieNotFound) return "state_cookie_missing";
  if (error instanceof InvalidOAuthError) return "invalid_oauth_callback";
  if (error instanceof InvalidHmacError) return "invalid_hmac";
  if (error instanceof ShopifyError) return error.constructor.name;
  if (error instanceof Response) return `http_response_${error.status}`;
  return "unknown_oauth_callback_error";
}

export function logOAuthCallbackValidationFailure(
  shop: string | null,
  error: unknown,
): void {
  logListingFixEvent({
    action: "session_missing",
    shop,
    message: error,
    meta: {
      event: "oauth_callback_validation_failure",
      failureType: classifyOAuthCallbackError(error),
      message: sanitizeErrorMessage(error),
      stateValidationFailure:
        error instanceof InvalidOAuthError ||
        error instanceof CookieNotFound,
      cookieValidationFailure: error instanceof CookieNotFound,
    },
  });
}

function safeUrlHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function extractCookieAttribute(
  setCookie: string | null,
  attribute: string,
): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${attribute}=([^;]+)`, "i"));
  return match?.[1] ?? (setCookie.includes(attribute) ? "true" : null);
}
