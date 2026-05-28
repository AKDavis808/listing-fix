import { Page, Text } from "@shopify/polaris";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { isRouteErrorResponse, useLocation, useRouteError } from "react-router";
import { useEffect } from "react";

import translations from "@shopify/polaris/locales/en.json";

import { ListingFixEmbeddedAuthFallback } from "./ListingFixEmbeddedAuthFallback";
import { logListingFixEvent } from "../../features/listingFix/telemetry";

function isUnauthorizedRouteError(error: unknown): boolean {
  if (isRouteErrorResponse(error)) {
    return error.status === 401;
  }
  return error instanceof Response && error.status === 401;
}

/**
 * SSR/client-safe reconnect UI when auth returns 401 inside the embedded shell.
 * Avoids rendering raw "401 Unauthorized" HTML that breaks hydration.
 */
export function ListingFixAppAuthReconnect() {
  const error = useRouteError();
  const location = useLocation();
  const search = location.search;
  const params = new URLSearchParams(search);
  const isEmbedded = params.get("embedded") === "1";
  const hasShop = Boolean(params.get("shop"));
  const shop = params.get("shop");

  useEffect(() => {
    if (!isUnauthorizedRouteError(error)) return;
    if (typeof window !== "undefined") {
      if (window.sessionStorage.getItem("listingfix_reconnect_shown") === "1") {
        return;
      }
      window.sessionStorage.setItem("listingfix_reconnect_shown", "1");
    }

    logListingFixEvent({
      action: "auth_401_caught",
      shop,
      meta: {
        boundary: "ListingFixAppAuthReconnect",
        pathname: location.pathname,
        embedded: isEmbedded,
      },
    });
    logListingFixEvent({
      action: "auth_reconnect_rendered",
      shop,
      meta: {
        pathname: location.pathname,
        embedded: isEmbedded,
        hasShop,
        event: "embedded_session_missing_offline_session",
        reconnectShownOnce: true,
      },
    });
  }, [error, hasShop, isEmbedded, location.pathname, shop]);

  if (!isUnauthorizedRouteError(error)) {
    return null;
  }

  if (
    typeof window !== "undefined" &&
    window.sessionStorage.getItem("listingfix_reconnect_shown") === "1"
  ) {
    return (
      <PolarisAppProvider i18n={translations}>
        <Page title="Reconnect ListingFix">
          <Text as="p" variant="bodyMd" tone="subdued">
            Reconnect was already shown for this browser session. Check Railway
            logs for OAuth session diagnostics.
          </Text>
        </Page>
      </PolarisAppProvider>
    );
  }

  const recoveryLoginUrl = `/auth/login${location.search}`;

  return (
    <PolarisAppProvider i18n={translations}>
      <Page title="Reconnect ListingFix">
        <ListingFixEmbeddedAuthFallback
          isEmbedded={isEmbedded}
          hasShop={hasShop}
          oauthInstallUrl={isEmbedded && hasShop ? recoveryLoginUrl : null}
        />
      </Page>
    </PolarisAppProvider>
  );
}
