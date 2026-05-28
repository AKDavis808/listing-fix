import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import type { Session } from "@shopify/shopify-api";

import prisma from "./db.server";
import { runAfterAuthPipeline } from "./features/listingFix/afterAuthPipeline.server";
import { logAuthDiagnosticOnce } from "./features/listingFix/authDiagnostics.server";
import {
  authenticateEmbeddedAdmin,
  loginWithEmbeddedContext,
  normalizeShopifyAppUrl,
} from "./features/listingFix/embeddedAuth.server";
import { logStartupUrlConfigDiagnostic } from "./features/listingFix/oauthCallbackDiagnostics.server";
import { logOAuthCookiePolicyStartup } from "./features/listingFix/oauthCookiePolicy.server";
import {
  logAuthRouteWiringDiagnostic,
  logStartupSessionDiagnostics,
} from "./features/listingFix/oauthSessionDiagnostics.server";
import { InstrumentedPrismaSessionStorage } from "./features/listingFix/prismaSessionStorage.server";
import { handleOAuthAuthRoute } from "./features/listingFix/shopifyOAuthRoute.server";

export const AUTH_PATH_PREFIX = "/auth";
export const AUTH_CALLBACK_PATH = `${AUTH_PATH_PREFIX}/callback`;

/** Temporarily use Shopify default auth redirects instead of custom reconnect handling. */
export const USE_SHOPIFY_DEFAULT_AUTH = true;

const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);
const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";
const apiSecretKey = process.env.SHOPIFY_API_SECRET?.trim() ?? "";
const scopes = process.env.SCOPES?.split(",");
const useOnlineTokens = false;
const expiringOfflineAccessTokens = true;
const distribution = AppDistribution.AppStore;

const sessionStorage = new InstrumentedPrismaSessionStorage(prisma);

logAuthDiagnosticOnce("shopify_auth_config", () => {
  console.info("[ListingFix][session_restored] Shopify auth config", {
    appUrl,
    distribution,
    useOnlineTokens,
    expiringOfflineAccessTokens,
    authPathPrefix: AUTH_PATH_PREFIX,
    authCallbackPath: AUTH_CALLBACK_PATH,
    sessionStorage: "InstrumentedPrismaSessionStorage",
    hasApiKey: Boolean(apiKey),
    hasApiSecret: Boolean(apiSecretKey),
    scopesConfigured: Boolean(scopes?.length),
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
});

void logStartupSessionDiagnostics();
logAuthRouteWiringDiagnostic(appUrl, distribution);
logStartupUrlConfigDiagnostic(appUrl, AUTH_CALLBACK_PATH, apiKey, scopes);
logOAuthCookiePolicyStartup();

type AfterAuthHookOptions = {
  session: Session;
  admin?: unknown;
};

export async function runListingFixAfterAuth(
  session: Session,
  options: {
    admin?: unknown;
    registerWebhooks?: (options: { session: Session }) => Promise<unknown>;
    storeSessionAlreadyCompleted?: boolean;
  } = {},
): Promise<void> {
  await runAfterAuthPipeline({
    session,
    admin: options.admin,
    registerWebhooks: options.registerWebhooks,
    storeSessionAlreadyCompleted: options.storeSessionAlreadyCompleted,
  });
}

const shopify = shopifyApp({
  apiKey,
  apiSecretKey,
  apiVersion: ApiVersion.October25,
  scopes,
  appUrl,
  authPathPrefix: AUTH_PATH_PREFIX,
  sessionStorage,
  distribution,
  useOnlineTokens,
  future: {
    expiringOfflineAccessTokens,
  },
  hooks: {
    afterAuth: async ({ session, admin }: AfterAuthHookOptions) => {
      await runListingFixAfterAuth(session, {
        admin,
        registerWebhooks: (opts) => shopify.registerWebhooks(opts),
        storeSessionAlreadyCompleted: true,
      });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticateAdminRaw = shopify.authenticate.admin.bind(
  shopify.authenticate,
);
export const authenticate = {
  ...shopify.authenticate,
  admin: USE_SHOPIFY_DEFAULT_AUTH
    ? authenticateAdminRaw
    : (request: Request) =>
        authenticateEmbeddedAdmin(request, authenticateAdminRaw),
};
export const unauthenticated = shopify.unauthenticated;
export const login = USE_SHOPIFY_DEFAULT_AUTH
  ? shopify.login.bind(shopify)
  : (request: Request) =>
      loginWithEmbeddedContext(request, shopify.login.bind(shopify));
export const registerWebhooks = shopify.registerWebhooks;
export { sessionStorage };

export async function handleShopifyOAuthAuthRoute(
  request: Request,
): Promise<Response | null> {
  return handleOAuthAuthRoute(request, {
    appUrl,
    authCallbackPath: AUTH_CALLBACK_PATH,
    expiringOfflineAccessTokens,
    runAfterAuth: runListingFixAfterAuth,
    sessionStorage,
  });
}
