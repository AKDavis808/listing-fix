import {
  CookieNotFound,
  InvalidHmacError,
  InvalidOAuthError,
  ShopifyError,
} from "@shopify/shopify-api";

import { isAuthDebugEnabled } from "./authDebugEnv.server";
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
  if (!isAuthDebugEnabled()) return;

  const computedRedirectUri = appUrl
    ? `${appUrl.replace(/\/$/, "")}${authCallbackPath}`
    : "";

  logListingFixEvent({
    action: "session_restored",
    meta: {
      event: "startup_url_config",
      shopifyAppUrl: appUrl.replace(/\/$/, "") || null,
      computedRedirectUri,
      expectedRedirectUrl: EXPECTED_REDIRECT_URL,
      redirectUriMatchesExpected:
        computedRedirectUri === EXPECTED_REDIRECT_URL,
      hasApiKey: Boolean(apiKey),
      scopes: scopes?.join(",") ?? null,
    },
  });
}

export function logOAuthCallbackQuery(_request: Request): void {
  // Reserved for auth debug tooling only.
}

export function logOAuthBeginResponse(
  _request: Request,
  _response: Response,
  _redirectUri: string,
  _callbackPath: string,
): void {
  // Reserved for auth debug tooling only.
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
    },
  });
}
