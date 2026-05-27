import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import translations from "@shopify/polaris/locales/en.json";

import { ListingFixEmbeddedAuthFallback } from "../../components/listingFix/ListingFixEmbeddedAuthFallback";
import {
  hasShopParam,
  isEmbeddedLoginRequest,
  logEmbeddedAuthEvent,
} from "../../features/listingFix/embeddedAuth.server";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  logEmbeddedAuthEvent("iframe_request", request, { route: "auth.login" });

  const isEmbedded = isEmbeddedLoginRequest(request);
  const hasShop = hasShopParam(request);

  if (isEmbedded) {
    logEmbeddedAuthEvent("embedded_detected", request, { route: "auth.login" });
  }

  if (hasShop) {
    logEmbeddedAuthEvent("oauth_start", request, { route: "auth.login" });
  } else if (isEmbedded) {
    logEmbeddedAuthEvent("session_missing", request, {
      route: "auth.login",
      reason: "embedded_without_shop",
    });
  }

  const errors = loginErrorMessage(await login(request));

  return {
    errors,
    isEmbedded,
    hasShop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  logEmbeddedAuthEvent("oauth_start", request, {
    route: "auth.login",
    method: "POST",
  });
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
    isEmbedded: isEmbeddedLoginRequest(request),
    hasShop: hasShopParam(request),
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const payload = actionData || loaderData;
  const { errors, isEmbedded, hasShop, apiKey } = payload;

  return (
    <AppProvider embedded={isEmbedded} apiKey={apiKey}>
      <PolarisAppProvider i18n={translations}>
        <s-page>
          {isEmbedded ? (
            <s-section heading="Reconnect ListingFix">
              <ListingFixEmbeddedAuthFallback
                isEmbedded={isEmbedded}
                hasShop={hasShop}
              />
              {errors.shop ? (
                <p style={{ color: "var(--p-color-text-critical)" }}>{errors.shop}</p>
              ) : null}
            </s-section>
          ) : (
            <Form method="post">
              <s-section heading="Log in">
                <ListingFixEmbeddedAuthFallback
                  isEmbedded={false}
                  hasShop={hasShop}
                />
                <s-text-field
                  name="shop"
                  label="Shop domain"
                  details="example.myshopify.com"
                  value={shop}
                  onChange={(e) => setShop(e.currentTarget.value)}
                  autocomplete="on"
                  error={errors.shop}
                ></s-text-field>
                <s-button type="submit">Log in</s-button>
              </s-section>
            </Form>
          )}
        </s-page>
      </PolarisAppProvider>
    </AppProvider>
  );
}
