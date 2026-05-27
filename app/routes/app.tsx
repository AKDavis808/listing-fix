import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";

import translations from "@shopify/polaris/locales/en.json";

import { ListingFixErrorBoundary } from "../components/listingFix/ListingFixErrorBoundary";
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
        <ListingFixTelemetryBootstrap shop={shop} />
        <ListingFixErrorBoundary shop={shop}>
          <s-app-nav>
            <s-link href="/app">ListingFix</s-link>
          </s-app-nav>
          <Outlet />
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

  return boundary.error(error);
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return <AppRouteErrorBoundary />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
