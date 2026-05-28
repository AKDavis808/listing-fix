import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  shopifyApi,
} from "@shopify/shopify-api";
import {
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
import { InstrumentedPrismaSessionStorage } from "./features/listingFix/prismaSessionStorage.server";
import {
  logSessionPersistenceEvent,
  verifyPrismaSessionPersisted,
} from "./features/listingFix/sessionPersistence.server";
import { bootstrapOfflineSessionIfNeeded } from "./features/listingFix/tokenExchangeBootstrap.server";
import { logListingFixEvent } from "./features/listingFix/telemetry";

const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);
const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";
const apiSecretKey = process.env.SHOPIFY_API_SECRET?.trim() ?? "";
const scopes = process.env.SCOPES?.split(",");
const useOnlineTokens = false;
const expiringOfflineAccessTokens = true;
const distribution = AppDistribution.AppStore;

function createListingFixShopifyApi() {
  if (!appUrl) {
    throw new Error("SHOPIFY_APP_URL is required.");
  }

  const url = new URL(appUrl);
  return shopifyApi({
    apiKey,
    apiSecretKey,
    apiVersion: ApiVersion.October25,
    scopes,
    hostName: url.host,
    hostScheme: url.protocol.replace(":", "") as "http" | "https",
    isEmbeddedApp: true,
    isCustomStoreApp: false,
  });
}

const listingFixApi = createListingFixShopifyApi();
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
      const verified = await verifyPrismaSessionPersisted(session);

      logAuthDiagnosticOnce(`after_auth:${session.shop}`, () => {
        logSessionPersistenceEvent("oauth_callback_completed", session.shop, {
          sessionId: session.id,
          isOnline: session.isOnline,
          prismaVerified: verified,
        });
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
export const authenticate = {
  ...shopify.authenticate,
  admin: async (request: Request) => {
    const bootstrapResult = await bootstrapOfflineSessionIfNeeded(
      request,
      listingFixApi,
      sessionStorage,
    );

    logAuthDiagnosticOnce(
      `bootstrap_complete:${bootstrapResult.offlineSessionId ?? "unknown"}:${bootstrapResult.status}`,
      () => {
        logListingFixEvent({
          action:
            bootstrapResult.status === "success"
              ? "session_restored"
              : "oauth_start",
          shop: new URL(request.url).searchParams.get("shop"),
          meta: {
            event: "bootstrap_complete_before_authenticate_admin",
            bootstrap_status: bootstrapResult.status,
            bootstrap_decision: bootstrapResult.decision,
            bootstrap_verify_session_saved: bootstrapResult.sessionVerified,
            offlineSessionId: bootstrapResult.offlineSessionId,
          },
        });
      },
    );

    return authenticateEmbeddedAdmin(
      request,
      shopify.authenticate.admin.bind(shopify.authenticate),
    );
  },
};
export const unauthenticated = shopify.unauthenticated;
export const login = (request: Request) => {
  const shop = new URL(request.url).searchParams.get("shop");
  logAuthDiagnosticOnce(`oauth_begin:${shop ?? "unknown"}`, () => {
    logSessionPersistenceEvent("oauth_begin", shop, {
      route: "auth.login",
      method: request.method,
    });
  });
  return loginWithEmbeddedContext(request, shopify.login.bind(shopify));
};
export const registerWebhooks = shopify.registerWebhooks;
export { sessionStorage };
