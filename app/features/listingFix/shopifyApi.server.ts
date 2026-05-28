import "@shopify/shopify-api/adapters/web-api";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";

import { normalizeShopifyAppUrl } from "./embeddedAuth.server";

const appUrl = normalizeShopifyAppUrl(process.env.SHOPIFY_APP_URL);
const appUrlObject = new URL(appUrl || "https://placeholder.local");

export const listingFixShopifyApi = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY?.trim() ?? "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET?.trim() ?? "",
  scopes: process.env.SCOPES?.split(","),
  hostName: appUrlObject.host,
  hostScheme: appUrlObject.protocol.replace(":", "") as "http" | "https",
  apiVersion: ApiVersion.October25,
  isEmbeddedApp: true,
});
