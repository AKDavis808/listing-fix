import { RequestedTokenType, type Shopify } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

import db from "../../db.server";
import { logAuthDiagnosticOnce } from "./authDiagnostics.server";
import {
  getOfflineSessionId,
  logSessionPersistenceEvent,
} from "./sessionPersistence.server";
import {
  resolveBootstrapRequestContext,
  type BootstrapDecision,
  type BootstrapRequestContext,
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

function logBootstrapDecision(
  shop: string,
  context: BootstrapRequestContext,
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  logAuthDiagnosticOnce(`bootstrap_decision:${shop}:${context.decision}`, () => {
    logListingFixEvent({
      action: "oauth_start",
      shop,
      meta: {
        event: "token_exchange_bootstrap_decision",
        bootstrap_decision: context.decision,
        hasUrlIdToken: Boolean(context.urlIdToken),
        hasAuthorizationHeader: context.hasAuthorizationHeader,
        isBounceRequest: context.isBounceRequest,
        token_exchange_token_shape_dotCount: context.shape.dotCount,
        token_exchange_token_shape_hasThreeJwtSections:
          context.shape.hasThreeJwtSections,
        token_exchange_token_shape_jwtSectionCount: context.shape.jwtSectionCount,
        token_exchange_token_shape_length: context.shape.length,
        token_exchange_token_prefix12: context.shape.tokenPrefix12,
        ...extra,
      },
    });
  });
}

function shouldPerformTokenExchange(
  decision: BootstrapDecision,
): decision is "bootstrap_from_url_id_token" {
  return decision === "bootstrap_from_url_id_token";
}

export async function bootstrapOfflineSessionIfNeeded(
  request: Request,
  api: Shopify,
  sessionStorage: SessionStorage,
): Promise<void> {
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return;

  const offlineSessionId = getOfflineSessionId(shop);
  const existingRow = await db.session.findUnique({
    where: { id: offlineSessionId },
  });
  const hasExistingOfflineSession = isOfflineRowUsable(existingRow);

  const context = resolveBootstrapRequestContext(
    request,
    hasExistingOfflineSession,
  );

  if (!shouldPerformTokenExchange(context.decision)) {
    logBootstrapDecision(shop, context, { offlineSessionId });
    return;
  }

  const token = context.token;
  if (!token) {
    logBootstrapDecision(shop, context, {
      offlineSessionId,
      reason: "missing_normalized_url_id_token",
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

  logBootstrapDecision(shop, context, {
    offlineSessionId,
    token_exchange_token_source: "url_id_token",
  });

  logAuthDiagnosticOnce(`token_exchange_start:${shop}:url_id_token`, () => {
    logSessionPersistenceEvent("token_exchange_start", shop, {
      offlineSessionId,
      bootstrap_decision: context.decision,
      token_exchange_token_source: "url_id_token",
      token_exchange_token_shape_dotCount: context.shape.dotCount,
      token_exchange_token_shape_hasThreeJwtSections:
        context.shape.hasThreeJwtSections,
      token_exchange_token_shape_jwtSectionCount: context.shape.jwtSectionCount,
      token_exchange_token_shape_length: context.shape.length,
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
      bootstrap_decision: context.decision,
      token_exchange_token_source: "url_id_token",
      token_exchange_token_shape_dotCount: context.shape.dotCount,
      token_exchange_token_shape_hasThreeJwtSections:
        context.shape.hasThreeJwtSections,
      token_exchange_token_shape_length: context.shape.length,
    });
  } catch (error) {
    rememberRejectedToken(shop, token);

    logAuthDiagnosticOnce(`token_exchange_failure:${shop}:url_id_token`, () => {
      logSessionPersistenceEvent("token_exchange_failure", shop, {
        offlineSessionId,
        bootstrap_decision: context.decision,
        token_exchange_token_source: "url_id_token",
        token_exchange_token_shape_dotCount: context.shape.dotCount,
        token_exchange_token_shape_hasThreeJwtSections:
          context.shape.hasThreeJwtSections,
        token_exchange_token_shape_jwtSectionCount: context.shape.jwtSectionCount,
        token_exchange_token_shape_length: context.shape.length,
        message: sanitizeErrorMessage(error),
      });
    });
  } finally {
    bootstrapInFlight.delete(inFlightKey);
  }
}
