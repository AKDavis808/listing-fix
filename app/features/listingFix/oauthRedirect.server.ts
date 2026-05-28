import { redirect } from "react-router";

import db from "../../db.server";
import {
  buildAuthTopLevelEscapeUrl,
  buildOAuthInProgressCookie,
  isEmbeddedOAuthRequest,
  isOAuthInProgress,
  logOAuthInProgressSkip,
} from "./embeddedOAuthEscape.server";
import {
  appendAuthFlowIdToUrl,
  buildAuthFlowCookie,
  getOrCreateAuthFlowId,
  recordAuthFlowStep,
} from "./authFlowTelemetry.server";
import { isAuthDebugEnabled } from "./authDebugEnv.server";
import { logRedirectToOAuth } from "./oauthSessionDiagnostics.server";
import { getOfflineSessionId } from "./sessionPersistence.server";

export async function hasOfflineSessionInPrisma(shop: string): Promise<boolean> {
  const offlineSessionId = getOfflineSessionId(shop);
  const row = await db.session.findUnique({
    where: { id: offlineSessionId },
    select: { id: true, accessToken: true, isOnline: true },
  });

  return Boolean(row?.accessToken && row.isOnline === false);
}

export function buildOAuthAuthUrl(request: Request): string {
  const url = new URL(request.url);
  const params = new URLSearchParams();

  const shop = url.searchParams.get("shop");
  if (shop) params.set("shop", shop);

  const host = url.searchParams.get("host");
  if (host) params.set("host", host);

  if (isEmbeddedOAuthRequest(request)) {
    return buildAuthTopLevelEscapeUrl(request);
  }

  params.set("embedded", "0");
  const query = params.toString();
  return `/auth${query ? `?${query}` : ""}`;
}

export function shouldDeferToEmbeddedTokenExchange(request: Request): boolean {
  if (!isEmbeddedOAuthRequest(request)) {
    return false;
  }

  const url = new URL(request.url);

  return (
    Boolean(url.searchParams.get("id_token")) ||
    Boolean(request.headers.get("authorization"))
  );
}

export async function ensureOfflineSessionOrRedirectToOAuth(
  request: Request,
  reason: string,
): Promise<void> {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return;
  }

  if (await hasOfflineSessionInPrisma(shop)) {
    return;
  }

  if (isOAuthInProgress(request)) {
    logOAuthInProgressSkip(request, shop);
    return;
  }

  if (shouldDeferToEmbeddedTokenExchange(request)) {
    recordAuthFlowStep(request, "embedded_token_exchange_deferred", {
      reason,
      shop,
      hasIdToken: Boolean(url.searchParams.get("id_token")),
      hasAuthorizationHeader: Boolean(request.headers.get("authorization")),
      pathname: url.pathname,
    });
    return;
  }

  const offlineSessionId = getOfflineSessionId(shop);
  let target = buildOAuthAuthUrl(request);
  const headers = new Headers();
  headers.append("set-cookie", buildOAuthInProgressCookie());

  if (isAuthDebugEnabled()) {
    const flowId = getOrCreateAuthFlowId(request);
    target = appendAuthFlowIdToUrl(target, flowId);
    headers.append("set-cookie", buildAuthFlowCookie(flowId));
    recordAuthFlowStep(request, "redirect_to_oauth", {
      reason,
      target,
      flowId,
      pathname: url.pathname,
    });
  }

  logRedirectToOAuth(request, shop, offlineSessionId, reason, target);

  throw redirect(target, { headers });
}
