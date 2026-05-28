import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
import { logAuthDiagnosticOnce } from "./features/listingFix/authDiagnostics.server";
import {
  authenticateEmbeddedAdmin,
  loginWithEmbeddedContext,
  normalizeShopifyAppUrl,
} from "./features/listingFix/embeddedAuth.server";
import {
  logAfterAuthFinished,
  logAfterAuthStart,
  logStartupSessionDiagnostics,
} from "./features/listingFix/oauthSessionDiagnostics.server";
import { InstrumentedPrismaSessionStorage } from "./features/listingFix/prismaSessionStorage.server";
import { verifyPrismaSessionPersisted } from "./features/listingFix/sessionPersistence.server";

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
    sessionStorage: "InstrumentedPrismaSessionStorage",
    hasApiKey: Boolean(apiKey),
    hasApiSecret: Boolean(apiSecretKey),
    scopesConfigured: Boolean(scopes?.length),
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
});

void logStartupSessionDiagnostics();

const shopify = shopifyApp({
  apiKey,
  apiSecretKey,
  apiVersion: ApiVersion.October25,
  scopes,
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage,
  distribution,
  useOnlineTokens,
  future: {
    expiringOfflineAccessTokens,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      logAfterAuthStart(session);

      const prismaVerified = await verifyPrismaSessionPersisted(session);

      logAfterAuthFinished(session, prismaVerified);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = {
  ...shopify.authenticate,
  admin: (request: Request) =>
    authenticateEmbeddedAdmin(
      request,
      shopify.authenticate.admin.bind(shopify.authenticate),
    ),
};
export const unauthenticated = shopify.unauthenticated;
export const login = (request: Request) =>
  loginWithEmbeddedContext(request, shopify.login.bind(shopify));
export const registerWebhooks = shopify.registerWebhooks;
export { sessionStorage };
