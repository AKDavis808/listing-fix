import type { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { PrismaClient } from "@prisma/client";

import {
  logLoadSessionResult,
  logStoreSessionFailure,
  logStoreSessionStart,
  logStoreSessionSuccess,
} from "./oauthSessionDiagnostics.server";
import { logSessionPersistenceEvent, verifyPrismaSessionPersisted } from "./sessionPersistence.server";

export class InstrumentedPrismaSessionStorage extends PrismaSessionStorage<PrismaClient> {
  async storeSession(session: Session): Promise<boolean> {
    logStoreSessionStart(session);

    try {
      const stored = await super.storeSession(session);
      const prismaVerified = await verifyPrismaSessionPersisted(session);
      logStoreSessionSuccess(session, stored, prismaVerified);
      return stored;
    } catch (error) {
      logStoreSessionFailure(session, error);
      throw error;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const session = await super.loadSession(id);
    logLoadSessionResult(id, session);
    return session;
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = await super.deleteSession(id);

    logSessionPersistenceEvent("prisma_session_lookup_failed", null, {
      sessionId: id,
      event: "prisma_session_deleted",
      deleted,
    });

    return deleted;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    return super.deleteSessions(ids);
  }
}
