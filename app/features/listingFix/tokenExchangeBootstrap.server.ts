import { RequestedTokenType, type Shopify } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

import db from "../../db.server";
import { verifyBootstrapSessionSaved } from "./bootstrapSessionVerify.server";
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
const rejectedTokenFingerprints = new Map<string, number>();
const REJECTED_TOKEN_TTL_MS = 60_000;
const shopBootstrapWork = new Map<string, Promise<BootstrapResult>>();

export type BootstrapResult = {
  status: "skipped" | "success" | "failure";
  decision: BootstrapDecision;
  sessionVerified: boolean;
  offlineSessionId: string | null;
  tokenSource: "authorization_header" | "url_id_token" | "missing";
};

type BootstrapPhase =
  | "bootstrap_started"
  | "bootstrap_exchange_complete"
  | "bootstrap_store_complete"
  | "bootstrap_verify_session_saved"
  | "bootstrap_finished"
  | "bootstrap_persist_failure";

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

function logBootstrapPhase(
  shop: string,
  phase: BootstrapPhase,
  meta?: Record<string, string | number | boolean | null | undefined>,
): void {
  logListingFixEvent({
    action:
      phase === "bootstrap_persist_failure"
        ? "session_missing"
        : phase === "bootstrap_finished"
          ? "session_restored"
          : "oauth_start",
    shop,
    meta: {
      event: phase,
      ...meta,
    },
  });
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
        token_exchange_token_source: context.tokenSource,
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

function skippedResult(
  context: BootstrapRequestContext,
  offlineSessionId: string | null,
): BootstrapResult {
  return {
    status: "skipped",
    decision: context.decision,
    sessionVerified: context.decision === "skip_existing_session",
    offlineSessionId,
    tokenSource: context.tokenSource,
  };
}

async function runBootstrapWork(
  request: Request,
  api: Shopify,
  sessionStorage: SessionStorage,
  shop: string,
): Promise<BootstrapResult> {
  const offlineSessionId = getOfflineSessionId(shop);
  const existingRow = await db.session.findUnique({
    where: { id: offlineSessionId },
  });
  const hasExistingOfflineSession = isOfflineRowUsable(existingRow);

  const context = resolveBootstrapRequestContext(
    request,
    hasExistingOfflineSession,
  );

  if (context.decision !== "bootstrap_from_authorization_header") {
    logBootstrapDecision(shop, context, { offlineSessionId });
    logBootstrapPhase(shop, "bootstrap_finished", {
      bootstrap_decision: context.decision,
      bootstrap_status: "skipped",
      token_exchange_token_source: context.tokenSource,
    });
    return skippedResult(context, offlineSessionId);
  }

  const token = context.token;
  if (!token) {
    logBootstrapDecision(shop, context, {
      offlineSessionId,
      reason: "missing_normalized_authorization_token",
    });
    logBootstrapPhase(shop, "bootstrap_finished", {
      bootstrap_decision: "skip_missing_token",
      bootstrap_status: "skipped",
      token_exchange_token_source: context.tokenSource,
    });
    return skippedResult(
      { ...context, decision: "skip_missing_token" },
      offlineSessionId,
    );
  }

  if (shouldSkipRejectedToken(shop, token)) {
    logBootstrapPhase(shop, "bootstrap_finished", {
      bootstrap_decision: context.decision,
      bootstrap_status: "skipped_rejected_token",
      token_exchange_token_source: "authorization_header",
    });
    return {
      status: "skipped",
      decision: context.decision,
      sessionVerified: false,
      offlineSessionId,
      tokenSource: "authorization_header",
    };
  }

  logBootstrapDecision(shop, context, {
    offlineSessionId,
    token_exchange_token_source: "authorization_header",
  });
  logBootstrapPhase(shop, "bootstrap_started", {
    bootstrap_decision: context.decision,
    offlineSessionId,
    token_exchange_token_source: "authorization_header",
  });

  try {
    const { session: exchangedSession } = await api.auth.tokenExchange({
      sessionToken: token,
      shop,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
      expiring: true,
    });

    logBootstrapPhase(shop, "bootstrap_exchange_complete", {
      sessionId: exchangedSession.id,
      offlineSessionId,
      token_exchange_token_source: "authorization_header",
    });

    logSessionPersistenceEvent("token_exchange_success", shop, {
      sessionId: exchangedSession.id,
      bootstrap_decision: context.decision,
      token_exchange_token_source: "authorization_header",
    });

    const stored = await sessionStorage.storeSession(exchangedSession);

    logBootstrapPhase(shop, "bootstrap_store_complete", {
      sessionId: exchangedSession.id,
      stored,
      offlineSessionId,
      token_exchange_token_source: "authorization_header",
    });

    const sessionVerified = await verifyBootstrapSessionSaved(
      sessionStorage,
      shop,
      exchangedSession,
    );

    logBootstrapPhase(shop, "bootstrap_verify_session_saved", {
      bootstrap_verify_session_saved: sessionVerified,
      sessionId: exchangedSession.id,
      offlineSessionId,
      token_exchange_token_source: "authorization_header",
    });

    if (!sessionVerified) {
      logBootstrapPhase(shop, "bootstrap_persist_failure", {
        sessionId: exchangedSession.id,
        offlineSessionId,
        stored,
        token_exchange_token_source: "authorization_header",
      });
      logBootstrapPhase(shop, "bootstrap_finished", {
        bootstrap_status: "failure",
        bootstrap_decision: context.decision,
        bootstrap_verify_session_saved: false,
        token_exchange_token_source: "authorization_header",
      });
      return {
        status: "failure",
        decision: context.decision,
        sessionVerified: false,
        offlineSessionId,
        tokenSource: "authorization_header",
      };
    }

    logBootstrapPhase(shop, "bootstrap_finished", {
      bootstrap_status: "success",
      bootstrap_decision: context.decision,
      bootstrap_verify_session_saved: true,
      sessionId: exchangedSession.id,
      offlineSessionId,
      token_exchange_token_source: "authorization_header",
    });

    return {
      status: "success",
      decision: context.decision,
      sessionVerified: true,
      offlineSessionId,
      tokenSource: "authorization_header",
    };
  } catch (error) {
    rememberRejectedToken(shop, token);

    logAuthDiagnosticOnce(
      `token_exchange_failure:${shop}:authorization_header`,
      () => {
        logSessionPersistenceEvent("token_exchange_failure", shop, {
          offlineSessionId,
          bootstrap_decision: context.decision,
          token_exchange_token_source: "authorization_header",
          message: sanitizeErrorMessage(error),
        });
      },
    );

    logBootstrapPhase(shop, "bootstrap_finished", {
      bootstrap_status: "failure",
      bootstrap_decision: context.decision,
      token_exchange_token_source: "authorization_header",
      message: sanitizeErrorMessage(error),
    });

    return {
      status: "failure",
      decision: context.decision,
      sessionVerified: false,
      offlineSessionId,
      tokenSource: "authorization_header",
    };
  }
}

export async function bootstrapOfflineSessionIfNeeded(
  request: Request,
  api: Shopify,
  sessionStorage: SessionStorage,
): Promise<BootstrapResult> {
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) {
    return {
      status: "skipped",
      decision: "skip_missing_token",
      sessionVerified: false,
      offlineSessionId: null,
      tokenSource: "missing",
    };
  }

  const existingWork = shopBootstrapWork.get(shop);
  if (existingWork) {
    return existingWork;
  }

  const work = runBootstrapWork(request, api, sessionStorage, shop);
  shopBootstrapWork.set(shop, work);

  try {
    return await work;
  } finally {
    if (shopBootstrapWork.get(shop) === work) {
      shopBootstrapWork.delete(shop);
    }
  }
}
