import db from "../../db.server";
import { isAuthDebugEnabled } from "./authDebugEnv.server";
import { normalizeShopifyAppUrl } from "./embeddedAuth.server";
import { getOfflineSessionId } from "./sessionPersistence.server";

const AUTH_PATH_PREFIX = "/auth";
const AUTH_CALLBACK_PATH = `${AUTH_PATH_PREFIX}/callback`;

const EXPECTED_PRODUCTION_APP_URL =
  "https://listing-fix-production.up.railway.app";

export type AuthDebugSnapshot = {
  enabled: boolean;
  shop: string | null;
  hostPresent: boolean;
  embeddedParam: string | null;
  cookiesReceived: string[];
  cookieHeaderPresent: boolean;
  prismaSessions: Array<{
    id: string;
    shop: string;
    isOnline: boolean;
    accessTokenPresent: boolean;
    expires: string | null;
  }>;
  offlineSessionId: string | null;
  offlineSessionFound: boolean;
  appUrl: string;
  redirectUrl: string | null;
  apiKeyPresent: boolean;
  apiSecretPresent: boolean;
  scopesConfigured: string[];
  authPathPrefix: string;
  authCallbackPath: string;
  pathname: string;
  authFlowId: string | null;
  expectedProductionAppUrl: string;
  appUrlMatchesProduction: boolean;
};

function parseCookieNames(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter(Boolean);
}

export async function buildAuthDebugSnapshot(
  request: Request,
): Promise<AuthDebugSnapshot | { enabled: false }> {
  if (!isAuthDebugEnabled()) {
    return { enabled: false };
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);
  const cookieHeader = request.headers.get("cookie");
  const offlineSessionId = shop ? getOfflineSessionId(shop) : null;

  let prismaSessions: AuthDebugSnapshot["prismaSessions"] = [];
  if (shop) {
    const rows = await db.session.findMany({
      where: { shop },
      select: {
        id: true,
        shop: true,
        isOnline: true,
        accessToken: true,
        expires: true,
      },
      orderBy: { id: "asc" },
    });

    prismaSessions = rows.map((row) => ({
      id: row.id,
      shop: row.shop,
      isOnline: row.isOnline,
      accessTokenPresent: Boolean(row.accessToken),
      expires: row.expires?.toISOString() ?? null,
    }));
  }

  const redirectUrl = appUrl
    ? `${appUrl.replace(/\/$/, "")}${AUTH_CALLBACK_PATH}`
    : null;

  const cookieMatch = cookieHeader?.match(/listingfix_auth_flow_id=([^;]+)/);

  return {
    enabled: true,
    shop,
    hostPresent: Boolean(url.searchParams.get("host")),
    embeddedParam: url.searchParams.get("embedded"),
    cookiesReceived: parseCookieNames(cookieHeader),
    cookieHeaderPresent: Boolean(cookieHeader),
    prismaSessions,
    offlineSessionId,
    offlineSessionFound: offlineSessionId
      ? prismaSessions.some(
          (row) => row.id === offlineSessionId && row.accessTokenPresent,
        )
      : false,
    appUrl,
    redirectUrl,
    apiKeyPresent: Boolean(process.env.SHOPIFY_API_KEY?.trim()),
    apiSecretPresent: Boolean(process.env.SHOPIFY_API_SECRET?.trim()),
    scopesConfigured: process.env.SCOPES?.split(",").filter(Boolean) ?? [],
    authPathPrefix: AUTH_PATH_PREFIX,
    authCallbackPath: AUTH_CALLBACK_PATH,
    pathname: url.pathname,
    authFlowId: cookieMatch?.[1]?.trim() ?? url.searchParams.get("authFlowId"),
    expectedProductionAppUrl: EXPECTED_PRODUCTION_APP_URL,
    appUrlMatchesProduction: appUrl === EXPECTED_PRODUCTION_APP_URL,
  };
}

export function renderAuthDebugHtml(snapshot: AuthDebugSnapshot): string {
  const rows = Object.entries(snapshot).map(([key, value]) => {
    const rendered =
      typeof value === "object" && value !== null
        ? `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`
        : escapeHtml(String(value));
    return `<tr><th>${escapeHtml(key)}</th><td>${rendered}</td></tr>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ListingFix Auth Debug</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; }
    table { border-collapse: collapse; width: 100%; max-width: 960px; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; vertical-align: top; text-align: left; }
    th { background: #f6f6f7; width: 220px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
    h1 { font-size: 20px; }
    p { color: #616161; }
  </style>
</head>
<body>
  <h1>ListingFix Auth Debug</h1>
  <p>DEBUG-only diagnostics. Disabled in production unless DEBUG=true or LISTINGFIX_AUTH_DEBUG=1.</p>
  <table>${rows.join("")}</table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
