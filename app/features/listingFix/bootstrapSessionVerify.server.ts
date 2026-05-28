import type { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

import db from "../../db.server";
import { getOfflineSessionId } from "./sessionPersistence.server";

export async function verifyBootstrapSessionSaved(
  sessionStorage: SessionStorage,
  shop: string,
  session: Session,
): Promise<boolean> {
  const offlineSessionId = getOfflineSessionId(shop);
  const fromStorage = await sessionStorage.loadSession(session.id);
  const fromPrisma = await db.session.findUnique({
    where: { id: offlineSessionId },
  });

  if (!fromStorage || !fromPrisma) {
    return false;
  }

  return (
    fromStorage.id === session.id &&
    fromStorage.shop === session.shop &&
    fromStorage.accessToken === session.accessToken &&
    fromPrisma.id === session.id &&
    fromPrisma.shop === session.shop &&
    fromPrisma.accessToken === session.accessToken
  );
}
