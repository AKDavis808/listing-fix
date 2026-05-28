import { RequestedTokenType, type Shopify } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

import db from "../../db.server";
import { logAuthDiagnosticOnce } from "./authDiagnostics.server";
import {
  getOfflineSessionId,
  logSessionPersistenceEvent,
} from "./sessionPersistence.server";
import {
  resolveSessionTokenForExchange,
  shouldAttemptTokenExchangeBootstrap,
  type SessionTokenSource,
} from "./sessionTokenInput.server";
import { logListingFixEvent, sanitizeErrorMessage } from "./telemetry";

const OFFLINE_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const bootstrapInFlight = new Set<string>();
const rejectedTokenFingerprints = new Map<string, number>();
const REJECTED_TOKEN_TTL_MS = 60_000;

function isOfflineRowUsable(
  row: {
    accessToken: string;
    expires: Date | null;
  } | null,
): boolean {
  if (!row?.accessToken) return false;
  if (!row.expires) return true;
  return row.expires.getTime() > Date.now() + OFFLINE_EXPIRY_BUFFER_MS;
}

function tokenFingerprint(token: string): string {
  return `${token.length}:${token.split(".").length}:${token.slice(0, 12)}:${token.slice(-12)}`;
}

function shouldSkipRejectedToken(shop: string, token: string): boolean {
  const key = `${shop}:${tokenFingerprint(token)}`;
  const rejectedAt = rejectedTokenFingerprints.get(key);
  if (!rejectedAt) return false;

  if (Date.now() - rejectedAt > REJECTED_TOKEN_TTL_MS) {
    rejectedTokenFingerprints.delete(key);
    return false;
  }

  return true;
}

function rememberRejectedToken(shop: string, token: string): void {
  rejectedTokenFingerprints.set(
    `${shop}:${tokenFingerprint(token)}`,
    Date.now(),
  );
}

function logTokenExchangeDiagnostics(
  shop: string,
  source: SessionTokenSource,
  shape: ReturnType<typeof resolveSessionTokenForExchange>["shape"],
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  logAuthDiagnosticOnce(`token_exchange_diag:${shop}:${source}`, () => {
    logListingFixEvent({
      action: "oauth_start",
      shop,
      meta: {
        event: "token_exchange_token_diagnostics",
        token_exchange_token_source: source,
        token_exchange_token_shape_dotCount: shape.dotCount,
        token_exchange_token_shape_length: shape.length,
        token_exchange_token_shape_hasThreeJwtSections: shape.hasThreeJwtSections,
        token_exchange_token_shape_startsWithBearer: shape.startsWithBearer,
        ...extra,
      },
    });
  });
}

export async function bootstrapOfflineSessionIfNeeded(
  request: Request,
  api: Shopify,
  sessionStorage: SessionStorage,
): Promise<void> {
  if (!shouldAttemptTokenExchangeBootstrap(request)) {
    return;
  }

  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return;

  const offlineSessionId = getOfflineSessionId(shop);
  const existingRow = await db.session.findUnique({
    where: { id: offlineSessionId },
  });

  if (isOfflineRowUsable(existingRow)) {
    return;
  }

  const { token, source, shape } = resolveSessionTokenForExchange(request);

  if (!token) {
    logTokenExchangeDiagnostics(shop, source, shape, {
      offlineSessionId,
      skipped: true,
      reason:
        source === "url_id_token"
          ? "url_id_token_invalid_shape"
          : source === "authorization_header"
            ? "authorization_header_invalid_shape"
            : "missing_session_token",
    });
    return;
  }

  if (shouldSkipRejectedToken(shop, token)) {
    return;
  }

  const inFlightKey = `${shop}:${tokenFingerprint(token)}`;
  if (bootstrapInFlight.has(inFlightKey)) {
    return;
  }

  bootstrapInFlight.add(inFlightKey);

  logTokenExchangeDiagnostics(shop, source, shape, {
    offlineSessionId,
  });

  logAuthDiagnosticOnce(`token_exchange_start:${shop}:${source}`, () => {
    logSessionPersistenceEvent("token_exchange_start", shop, {
      offlineSessionId,
      token_exchange_token_source: source,
      token_exchange_token_shape_hasThreeJwtSections: shape.hasThreeJwtSections,
      token_exchange_token_shape_length: shape.length,
    });
  });

  try {
    const { session } = await api.auth.tokenExchange({
      sessionToken: token,
      shop,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
      expiring: true,
    });

    const stored = await sessionStorage.storeSession(session);

    logSessionPersistenceEvent("token_exchange_success", shop, {
      sessionId: session.id,
      stored,
      token_exchange_token_source: source,
      token_exchange_token_shape_hasThreeJwtSections: shape.hasThreeJwtSections,
      token_exchange_token_shape_length: shape.length,
    });
  } catch (error) {
    rememberRejectedToken(shop, token);

    logAuthDiagnosticOnce(`token_exchange_failure:${shop}:${source}`, () => {
      logSessionPersistenceEvent("token_exchange_failure", shop, {
        offlineSessionId,
        token_exchange_token_source: source,
        token_exchange_token_shape_hasThreeJwtSections: shape.hasThreeJwtSections,
        token_exchange_token_shape_length: shape.length,
        message: sanitizeErrorMessage(error),
      });
    });
  } finally {
    bootstrapInFlight.delete(inFlightKey);
  }
}
