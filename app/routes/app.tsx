import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { BlockStack, Box, Text } from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { isRouteErrorResponse } from "react-router";

import translations from "@shopify/polaris/locales/en.json";

import { ListingFixAppAuthReconnect } from "../components/listingFix/ListingFixAppAuthReconnect";
import { ListingFixAppNav } from "../components/listingFix/ListingFixAppNav";
import { ListingFixEmbeddedBootstrap } from "../components/listingFix/ListingFixEmbeddedBootstrap";
import { ListingFixErrorBoundary } from "../components/listingFix/ListingFixErrorBoundary";
import {
  ListingFixFeedbackFooter,
  ListingFixFeedbackProvider,
} from "../components/listingFix/ListingFixFeedback";
import { ListingFixTelemetryBootstrap } from "../components/listingFix/ListingFixTelemetryBootstrap";
import { logListingFixEvent } from "../features/listingFix/telemetry";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

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

function isUnauthorizedRouteError(error: unknown): boolean {
  if (isRouteErrorResponse(error)) {
    return error.status === 401;
  }
  return error instanceof Response && error.status === 401;
}

function AppRouteErrorBoundary() {
  const error = useRouteError();

  useEffect(() => {
    if (isUnauthorizedRouteError(error)) {
      logListingFixEvent({
        action: "auth_401_caught",
        meta: { boundary: "app_route" },
      });
      return;
    }

    logListingFixEvent({
      action: "runtime_error",
      message: error,
      meta: { boundary: "app_route" },
    });
  }, [error]);

  if (isUnauthorizedRouteError(error)) {
    return <ListingFixAppAuthReconnect />;
  }

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
