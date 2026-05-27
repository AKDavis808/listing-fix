import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import {
  authenticateEmbeddedAdmin,
  loginWithEmbeddedContext,
  normalizeShopifyAppUrl,
} from "./features/listingFix/embeddedAuth.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL),
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
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
export const login = (request: Request) =>
  loginWithEmbeddedContext(request, shopify.login.bind(shopify));
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
