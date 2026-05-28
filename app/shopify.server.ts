import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
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
import { logListingFixEvent } from "./features/listingFix/telemetry";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY?.trim(),
  apiSecretKey: process.env.SHOPIFY_API_SECRET?.trim() || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL),
  authPathPrefix: "/auth",
  sessionStorage: new InstrumentedPrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      logSessionPersistenceEvent("oauth_callback_completed", session.shop, {
        sessionId: session.id,
        isOnline: session.isOnline,
      });

      const verified = await verifyPrismaSessionPersisted(session);

      logListingFixEvent({
        action: "oauth_complete",
        shop: session.shop,
        meta: {
          event: "oauth_callback_session_stored",
          sessionId: session.id,
          isOnline: session.isOnline,
          prismaVerified: verified,
        },
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
  admin: (request: Request) =>
    authenticateEmbeddedAdmin(request, shopify.authenticate.admin.bind(shopify.authenticate)),
};
export const unauthenticated = shopify.unauthenticated;
export const login = (request: Request) => {
  const shop = new URL(request.url).searchParams.get("shop");
  logSessionPersistenceEvent("oauth_begin", shop, {
    route: "auth.login",
    method: request.method,
  });
  return loginWithEmbeddedContext(request, shopify.login.bind(shopify));
};
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
