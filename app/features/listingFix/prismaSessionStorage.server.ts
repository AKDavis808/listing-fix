import type { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { PrismaClient } from "@prisma/client";

import {
  logSessionPersistenceEvent,
  verifyPrismaSessionPersisted,
} from "./sessionPersistence.server";

export class InstrumentedPrismaSessionStorage extends PrismaSessionStorage<PrismaClient> {
  async storeSession(session: Session): Promise<boolean> {
    const stored = await super.storeSession(session);

    logSessionPersistenceEvent("prisma_session_saved", session.shop, {
      sessionId: session.id,
      isOnline: session.isOnline,
      stored,
    });

    await verifyPrismaSessionPersisted(session);

    return stored;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const session = await super.loadSession(id);

    if (session) {
      logSessionPersistenceEvent("prisma_session_lookup", session.shop, {
        sessionId: id,
        found: true,
        isOnline: session.isOnline,
      });
    } else {
      logSessionPersistenceEvent("prisma_session_lookup_failed", null, {
        sessionId: id,
        reason: "load_session_miss",
      });
    }

    return session;
  }
}
