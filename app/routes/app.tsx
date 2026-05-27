import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { BlockStack } from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";

import translations from "@shopify/polaris/locales/en.json";

import { ListingFixAppNav } from "../components/listingFix/ListingFixAppNav";
import { ListingFixEmbeddedAuthFallback } from "../components/listingFix/ListingFixEmbeddedAuthFallback";
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

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={translations}>
        <ListingFixEmbeddedBootstrap shop={shop} />
        <ListingFixTelemetryBootstrap shop={shop} />
        <ListingFixErrorBoundary shop={shop}>
          <ListingFixFeedbackProvider shop={shop}>
            <BlockStack gap="0">
              <ListingFixAppNav />
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
    logListingFixEvent({
      action: "runtime_error",
      message: error,
      meta: { boundary: "app_route" },
    });
  }, [error]);

  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const isEmbedded = params.get("embedded") === "1";

    if (isEmbedded) {
      return (
        <AppProvider embedded apiKey={process.env.SHOPIFY_API_KEY ?? ""}>
          <PolarisAppProvider i18n={translations}>
            <s-page heading="ListingFix">
              <s-section>
                <ListingFixEmbeddedAuthFallback
                  isEmbedded
                  hasShop={Boolean(params.get("shop"))}
                />
              </s-section>
            </s-page>
          </PolarisAppProvider>
        </AppProvider>
      );
    }
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
