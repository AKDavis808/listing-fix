import { redirect } from "react-router";

import db from "../../db.server";
import {
  buildOAuthInProgressCookie,
  isOAuthInProgress,
  logOAuthInProgressSkip,
} from "./embeddedOAuthEscape.server";
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

  if (url.searchParams.get("embedded") === "1") {
    params.set("embedded", "1");
  }

  const query = params.toString();
  return `/auth${query ? `?${query}` : ""}`;
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

  const offlineSessionId = getOfflineSessionId(shop);
  const target = buildOAuthAuthUrl(request);

  logRedirectToOAuth(request, shop, offlineSessionId, reason, target);

  throw redirect(target, {
    headers: {
      "set-cookie": buildOAuthInProgressCookie(),
    },
  });
}
