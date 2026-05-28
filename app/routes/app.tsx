import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { BlockStack, Box, Text } from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { isRouteErrorResponse } from "react-router";

import translations from "@shopify/polaris/locales/en.json";

import { ListingFixAppNav } from "../components/listingFix/ListingFixAppNav";
import { ListingFixEmbeddedBootstrap } from "../components/listingFix/ListingFixEmbeddedBootstrap";
import { ListingFixErrorBoundary } from "../components/listingFix/ListingFixErrorBoundary";
import {
  ListingFixFeedbackFooter,
  ListingFixFeedbackProvider,
} from "../components/listingFix/ListingFixFeedback";
import { ListingFixTelemetryBootstrap } from "../components/listingFix/ListingFixTelemetryBootstrap";
import { ensureOfflineSessionOrRedirectToOAuth } from "../features/listingFix/oauthRedirect.server";
import { logListingFixEvent } from "../features/listingFix/telemetry";
import { authenticateAdminRaw } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await ensureOfflineSessionOrRedirectToOAuth(request, "app_missing_offline_session");

  const { session } = await authenticateAdminRaw(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop };
};

export default function App() {
  const { apiKey, shop } = useLoaderData<typeof loader>();

  useEffect(() => {
    logListingFixEvent({
      action: "dashboard_render",
      shop,
      meta: { event: "app_layout_rendered", source: "client" },
    });
    console.log("app_layout_rendered", { shop });
  }, [shop]);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={translations}>
        <ListingFixEmbeddedBootstrap shop={shop} />
        <ListingFixTelemetryBootstrap shop={shop} />
        <ListingFixAppNav />
        <ListingFixErrorBoundary shop={shop}>
          <ListingFixFeedbackProvider shop={shop}>
            <BlockStack gap="0">
              <Box padding="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  [debug] app layout outlet marker
                </Text>
              </Box>
              <Outlet />
              <ListingFixFeedbackFooter />
            </BlockStack>
          </ListingFixFeedbackProvider>
        </ListingFixErrorBoundary>
      </PolarisAppProvider>
    </AppProvider>
  );
}

function AppRouteErrorBoundary() {
  const error = useRouteError();

  useEffect(() => {
    if (error instanceof Response || isRouteErrorResponse(error)) {
      logListingFixEvent({
        action: "auth_401_caught",
        meta: {
          boundary: "app_route",
          status: error instanceof Response ? error.status : error.status,
          note: "shopify_default_auth_error_boundary",
        },
      });
      return;
    }

    logListingFixEvent({
      action: "runtime_error",
      message: error,
      meta: { boundary: "app_route" },
    });
  }, [error]);

  if (error instanceof Response) {
    return boundary.error(error);
  }

  return boundary.error(error);
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return <AppRouteErrorBoundary />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
