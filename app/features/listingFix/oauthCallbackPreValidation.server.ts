import type { AuthQuery } from "@shopify/shopify-api";
import { STATE_COOKIE_NAME } from "@shopify/shopify-api";
import {
  Cookies,
  abstractConvertRequest,
  createSHA256HMAC,
  HashFormat,
} from "@shopify/shopify-api/runtime";

import { listingFixShopifyApi } from "./shopifyApi.server";
import { logListingFixEvent } from "./telemetry";
import { STATE_COOKIE_NAME as LOCAL_STATE_COOKIE_NAME } from "./oauthCookiePolicy.server";

const EXPECTED_PRODUCTION_APP_URL =
  "https://listing-fix-production.up.railway.app";
const EXPECTED_CALLBACK_PATH = "/auth/callback";
const EXPECTED_REDIRECT_URL = `${EXPECTED_PRODUCTION_APP_URL}${EXPECTED_CALLBACK_PATH}`;
const EXPECTED_TOML_CLIENT_ID = "eb3e7bb9b288288370fd990fcacf126e";

export type OAuthCallbackPreValidation = {
  callback_shop: string | null;
  callback_code_present: boolean;
  callback_hmac_present: boolean;
  callback_timestamp_present: boolean;
  callback_host_present: boolean;
  callback_state_present: boolean;
  callback_state_matches_cookie: boolean | null;
  state_cookie_verified: boolean;
  cookie_validation_failure: boolean;
  duplicate_state_cookie_detected: boolean;
  callback_hmac_valid: boolean | null;
  callback_hmac_expected_prefix: string | null;
  callback_hmac_received_prefix: string | null;
  callback_hmac_validation_error: string | null;
  callback_timestamp_within_tolerance: boolean | null;
  configured_api_key_prefix: string | null;
  configured_api_key_matches_toml_client_id: boolean;
  configured_redirect_uri: string | null;
  redirect_uri_matches_expected: boolean;
  shopify_api_secret_present: boolean;
  shopify_api_secret_length: number | null;
};

function countCookieOccurrences(
  cookieHeader: string | null,
  name: string,
): number {
  if (!cookieHeader) return 0;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|;\\s*)${escaped}=`, "g");
  return cookieHeader.match(pattern)?.length ?? 0;
}

function buildAuthQueryFromRequest(request: Request): AuthQuery {
  const url = new URL(request.url);
  const authQuery: AuthQuery = {};

  url.searchParams.forEach((value, key) => {
    authQuery[key] = value;
  });

  return authQuery;
}

async function computeShopifyAdminOAuthHmac(
  query: AuthQuery,
  secret: string,
): Promise<string> {
  const processed = new URLSearchParams();

  for (const key of Object.keys(query).sort((a, b) => a.localeCompare(b))) {
    if (key === "hmac" || key === "signature") continue;
    const value = query[key];
    if (value !== undefined) {
      processed.append(key, value);
    }
  }

  return createSHA256HMAC(secret, processed.toString(), HashFormat.Hex);
}

async function readVerifiedStateFromCookie(
  request: Request,
  apiSecretKey: string,
): Promise<string | undefined> {
  const normalizedRequest = await abstractConvertRequest({ rawRequest: request });
  const cookies = new Cookies(normalizedRequest, {}, {
    keys: [apiSecretKey],
    secure: true,
  });

  return cookies.getAndVerify(STATE_COOKIE_NAME);
}

function isTimestampWithinTolerance(timestamp: string | null): boolean | null {
  if (!timestamp) return null;

  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) return false;

  const now = Math.trunc(Date.now() / 1000);
  return Math.abs(now - parsed) <= 90;
}

export async function runOAuthCallbackPreValidation(
  request: Request,
  options: {
    appUrl: string;
    authCallbackPath: string;
  },
): Promise<OAuthCallbackPreValidation> {
  const url = new URL(request.url);
  const cookieHeader = request.headers.get("cookie");
  const authQuery = buildAuthQueryFromRequest(request);
  const apiSecretKey = listingFixShopifyApi.config.apiSecretKey.trim();
  const apiKey = listingFixShopifyApi.config.apiKey.trim();
  const receivedHmac = url.searchParams.get("hmac");
  const queryState = url.searchParams.get("state");
  const configuredRedirectUri = `${options.appUrl.replace(/\/$/, "")}${options.authCallbackPath}`;

  let stateFromCookie: string | undefined;
  let callback_hmac_valid: boolean | null = null;
  let callback_hmac_expected_prefix: string | null = null;
  let callback_hmac_received_prefix = receivedHmac
    ? receivedHmac.slice(0, 8)
    : null;
  let callback_hmac_validation_error: string | null = null;

  try {
    stateFromCookie = await readVerifiedStateFromCookie(request, apiSecretKey);
  } catch {
    stateFromCookie = undefined;
  }

  if (receivedHmac && apiSecretKey) {
    try {
      callback_hmac_valid =
        await listingFixShopifyApi.utils.validateHmac(authQuery);
      const expected = await computeShopifyAdminOAuthHmac(
        authQuery,
        apiSecretKey,
      );
      callback_hmac_expected_prefix = expected.slice(0, 8);
    } catch (error) {
      callback_hmac_valid = false;
      callback_hmac_validation_error =
        error instanceof Error ? error.message : String(error);

      if (apiSecretKey) {
        const expected = await computeShopifyAdminOAuthHmac(
          authQuery,
          apiSecretKey,
        ).catch(() => null);
        callback_hmac_expected_prefix = expected?.slice(0, 8) ?? null;
      }
    }
  }

  const duplicateStateCount = Math.max(
    countCookieOccurrences(cookieHeader, STATE_COOKIE_NAME),
    countCookieOccurrences(cookieHeader, LOCAL_STATE_COOKIE_NAME),
  );

  const callback_state_matches_cookie =
    queryState && stateFromCookie
      ? queryState === stateFromCookie
      : queryState
        ? false
        : null;

  return {
    callback_shop: url.searchParams.get("shop"),
    callback_code_present: Boolean(url.searchParams.get("code")),
    callback_hmac_present: Boolean(receivedHmac),
    callback_timestamp_present: Boolean(url.searchParams.get("timestamp")),
    callback_host_present: Boolean(url.searchParams.get("host")),
    callback_state_present: Boolean(queryState),
    callback_state_matches_cookie,
    state_cookie_verified: Boolean(stateFromCookie),
    cookie_validation_failure: !stateFromCookie,
    duplicate_state_cookie_detected: duplicateStateCount > 1,
    callback_hmac_valid,
    callback_hmac_expected_prefix,
    callback_hmac_received_prefix,
    callback_hmac_validation_error,
    callback_timestamp_within_tolerance: isTimestampWithinTolerance(
      url.searchParams.get("timestamp"),
    ),
    configured_api_key_prefix: apiKey ? apiKey.slice(0, 8) : null,
    configured_api_key_matches_toml_client_id:
      apiKey === EXPECTED_TOML_CLIENT_ID,
    configured_redirect_uri: configuredRedirectUri,
    redirect_uri_matches_expected:
      configuredRedirectUri === EXPECTED_REDIRECT_URL,
    shopify_api_secret_present: Boolean(apiSecretKey),
    shopify_api_secret_length: apiSecretKey ? apiSecretKey.length : null,
  };
}

export function logOAuthCallbackPreValidation(
  request: Request,
  validation: OAuthCallbackPreValidation,
): void {
  logListingFixEvent({
    action: "oauth_start",
    shop: validation.callback_shop,
    meta: {
      event: "oauth_callback_pre_validation",
      expectedRedirectUrl: EXPECTED_REDIRECT_URL,
      expectedTomlClientIdPrefix: EXPECTED_TOML_CLIENT_ID.slice(0, 8),
      ...validation,
    },
  });
}

export {
  EXPECTED_PRODUCTION_APP_URL,
  EXPECTED_CALLBACK_PATH,
  EXPECTED_REDIRECT_URL,
  EXPECTED_TOML_CLIENT_ID,
};
