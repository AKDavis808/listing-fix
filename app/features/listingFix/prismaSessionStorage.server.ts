import type { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { PrismaClient } from "@prisma/client";

import { logAuthDiagnosticOnce } from "./authDiagnostics.server";
import {
  logSessionPersistenceEvent,
  verifyPrismaSessionPersisted,
} from "./sessionPersistence.server";

export class InstrumentedPrismaSessionStorage extends PrismaSessionStorage<PrismaClient> {
  async storeSession(session: Session): Promise<boolean> {
    const stored = await super.storeSession(session);

    logAuthDiagnosticOnce(`store:${session.id}`, () => {
      logSessionPersistenceEvent("prisma_session_saved", session.shop, {
        sessionId: session.id,
        isOnline: session.isOnline,
        stored,
      });
    });

    const verified = await verifyPrismaSessionPersisted(session);
    if (!verified) {
      logSessionPersistenceEvent("prisma_session_lookup_failed", session.shop, {
        sessionId: session.id,
        reason: "store_verify_failed",
      });
    }

    return stored;
  }
}
