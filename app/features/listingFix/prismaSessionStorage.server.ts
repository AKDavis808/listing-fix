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

  async loadSession(id: string): Promise<Session | undefined> {
    const session = await super.loadSession(id);

    logAuthDiagnosticOnce(`load:${id}:${session ? "found" : "missing"}`, () => {
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
    });

    return session;
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = await super.deleteSession(id);

    logAuthDiagnosticOnce(`delete:${id}`, () => {
      logSessionPersistenceEvent("prisma_session_lookup_failed", null, {
        sessionId: id,
        event: "prisma_session_deleted",
        deleted,
      });
    });

    return deleted;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    const deleted = await super.deleteSessions(ids);

    logAuthDiagnosticOnce(`delete_many:${ids.length}`, () => {
      logSessionPersistenceEvent("prisma_session_lookup_failed", null, {
        event: "prisma_sessions_deleted",
        count: ids.length,
        deleted,
      });
    });

    return deleted;
  }
}
