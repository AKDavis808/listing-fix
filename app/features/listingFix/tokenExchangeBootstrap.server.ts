import { RequestedTokenType, type Shopify } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

import db from "../../db.server";
import { logAuthDiagnosticOnce } from "./authDiagnostics.server";
import {
  getOfflineSessionId,
  logSessionPersistenceEvent,
} from "./sessionPersistence.server";
import { sanitizeErrorMessage } from "./telemetry";

const OFFLINE_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const bootstrapInFlight = new Set<string>();

function hasAuthorizationHeader(request: Request): boolean {
  return Boolean(request.headers.get("authorization")?.match(/^Bearer /i));
}

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

export async function bootstrapOfflineSessionIfNeeded(
  request: Request,
  api: Shopify,
  sessionStorage: SessionStorage,
): Promise<void> {
  if (!hasAuthorizationHeader(request)) return;

  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return;

  const offlineSessionId = getOfflineSessionId(shop);
  const existingRow = await db.session.findUnique({
    where: { id: offlineSessionId },
  });

  if (isOfflineRowUsable(existingRow)) {
    return;
  }

  if (bootstrapInFlight.has(shop)) {
    return;
  }

  bootstrapInFlight.add(shop);

  const sessionToken = request.headers.get("authorization")!.replace(/^Bearer /i, "");

  logAuthDiagnosticOnce(`token_exchange_start:${shop}`, () => {
    logSessionPersistenceEvent("token_exchange_start", shop, {
      offlineSessionId,
    });
  });

  try {
    const { session } = await api.auth.tokenExchange({
      sessionToken,
      shop,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
      expiring: true,
    });

    const stored = await sessionStorage.storeSession(session);

    logSessionPersistenceEvent("token_exchange_success", shop, {
      sessionId: session.id,
      stored,
    });
  } catch (error) {
    logSessionPersistenceEvent("token_exchange_failure", shop, {
      offlineSessionId,
      message: sanitizeErrorMessage(error),
    });
  } finally {
    bootstrapInFlight.delete(shop);
  }
}
