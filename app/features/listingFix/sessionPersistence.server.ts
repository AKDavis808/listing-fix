import type { Session } from "@shopify/shopify-api";

import db from "../../db.server";
import { logAuthDiagnosticOnce } from "./authDiagnostics.server";
import { logListingFixEvent } from "./telemetry";

export type SessionPersistenceEvent =
  | "oauth_begin"
  | "oauth_callback_entered"
  | "oauth_callback_completed"
  | "token_exchange_start"
  | "token_exchange_success"
  | "token_exchange_failure"
  | "prisma_session_saved"
  | "prisma_session_lookup"
  | "prisma_session_lookup_failed"
  | "offline_session_id"
  | "online_session_id";

function normalizeShopDomain(shop: string): string {
  const withoutProtocol = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (withoutProtocol.indexOf(".") === -1) {
    return `${withoutProtocol}.myshopify.com`;
  }
  return withoutProtocol;
}

export function getOfflineSessionId(shop: string): string {
  return `offline_${normalizeShopDomain(shop)}`;
}

export function getOnlineSessionId(shop: string, userId: string): string {
  return `${normalizeShopDomain(shop)}_${userId}`;
}

export function logSessionPersistenceEvent(
  event: SessionPersistenceEvent,
  shop?: string | null,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  const action =
    event === "oauth_callback_completed" ||
    event === "token_exchange_success" ||
    event === "token_exchange_failure"
      ? "oauth_complete"
      : event.startsWith("oauth_") || event === "token_exchange_start"
        ? "oauth_start"
        : event === "prisma_session_saved" ||
            event === "offline_session_id" ||
            event === "online_session_id"
          ? "session_restored"
          : "session_missing";

  logListingFixEvent({
    action,
    shop,
    meta: {
      event,
      ...meta,
    },
  });
}

export async function verifyPrismaSessionPersisted(
  session: Session,
): Promise<boolean> {
  const row = await db.session.findUnique({ where: { id: session.id } });

  if (!row) {
    return false;
  }

  return row.shop === session.shop && row.accessToken === session.accessToken;
}

export function logOfflineSessionMissingOnce(shop: string): void {
  const offlineSessionId = getOfflineSessionId(shop);
  logAuthDiagnosticOnce(`offline_missing:${shop}`, () => {
    logSessionPersistenceEvent("prisma_session_lookup_failed", shop, {
      sessionId: offlineSessionId,
      reason: "offline_missing",
    });
  });
}
