import type { Session } from "@shopify/shopify-api";

import db from "../../db.server";
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
            event === "online_session_id" ||
            (event === "prisma_session_lookup" && meta?.found === true)
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

export async function lookupPrismaSessionRow(
  sessionId: string,
  shop?: string | null,
) {
  logSessionPersistenceEvent("prisma_session_lookup", shop, { sessionId });

  const row = await db.session.findUnique({ where: { id: sessionId } });
  if (!row) {
    logSessionPersistenceEvent("prisma_session_lookup_failed", shop, {
      sessionId,
      reason: "not_found",
    });
    return null;
  }

  logSessionPersistenceEvent("prisma_session_lookup", shop, {
    sessionId,
    found: true,
    storedShop: row.shop,
    isOnline: row.isOnline,
    hasAccessToken: Boolean(row.accessToken),
  });

  return row;
}

export async function verifyPrismaSessionPersisted(
  session: Session,
): Promise<boolean> {
  const row = await db.session.findUnique({ where: { id: session.id } });

  if (!row) {
    logSessionPersistenceEvent("prisma_session_lookup_failed", session.shop, {
      sessionId: session.id,
      reason: "after_auth_verify_missing",
      isOnline: session.isOnline,
    });
    return false;
  }

  const shopMatches = row.shop === session.shop;
  const tokenMatches = row.accessToken === session.accessToken;

  logSessionPersistenceEvent("prisma_session_saved", session.shop, {
    sessionId: session.id,
    verified: true,
    shopMatches,
    tokenMatches,
    isOnline: row.isOnline,
    storedShop: row.shop,
  });

  return shopMatches && tokenMatches;
}

export async function logShopSessionSnapshot(shop: string): Promise<void> {
  const offlineSessionId = getOfflineSessionId(shop);
  logSessionPersistenceEvent("offline_session_id", shop, {
    sessionId: offlineSessionId,
  });

  const offlineRow = await db.session.findUnique({
    where: { id: offlineSessionId },
  });

  if (offlineRow) {
    logSessionPersistenceEvent("prisma_session_lookup", shop, {
      sessionId: offlineSessionId,
      found: true,
      storedShop: offlineRow.shop,
      isOnline: offlineRow.isOnline,
    });
  } else {
    logSessionPersistenceEvent("prisma_session_lookup_failed", shop, {
      sessionId: offlineSessionId,
      reason: "offline_missing",
    });
  }

  const onlineRows = await db.session.findMany({
    where: { shop, isOnline: true },
    take: 5,
    orderBy: [{ expires: "desc" }],
  });

  for (const row of onlineRows) {
    logSessionPersistenceEvent("online_session_id", shop, {
      sessionId: row.id,
      storedShop: row.shop,
    });
  }
}
