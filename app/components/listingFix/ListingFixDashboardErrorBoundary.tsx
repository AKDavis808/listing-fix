import type { ReactNode } from "react";
import { Component } from "react";
import { Banner, BlockStack, Page, Text } from "@shopify/polaris";

import { ListingFixDashboardDebugPanel } from "./ListingFixDashboardDebugPanel";
import { logListingFixEvent } from "../../features/listingFix/telemetry";

type Props = {
  children: ReactNode;
  shop?: string | null;
  loaderOk: boolean;
  productCount: number;
  auditCount: number;
  bridgeReady: boolean;
};

type State = {
  hasError: boolean;
  message: string | null;
};

export class ListingFixDashboardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown dashboard render error";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    logListingFixEvent({
      action: "dashboard_render_error",
      shop: this.props.shop,
      message: error,
      meta: {
        boundary: "ListingFixDashboardErrorBoundary",
        componentStack: info.componentStack?.slice(0, 800) ?? null,
        bridgeReady: this.props.bridgeReady,
        loaderOk: this.props.loaderOk,
        productCount: this.props.productCount,
        auditCount: this.props.auditCount,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <Page title="ListingFix">
          <BlockStack gap="400">
            <Banner tone="critical" title="Dashboard failed to render">
              <Text as="p" variant="bodyMd">
                ListingFix loaded your session but the dashboard hit a client error.
                Reload the app from Shopify Admin. If this keeps happening, share the
                debug details below with support.
              </Text>
              {this.state.message ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {this.state.message}
                </Text>
              ) : null}
            </Banner>
            <ListingFixDashboardDebugPanel
              loaderOk={this.props.loaderOk}
              productCount={this.props.productCount}
              auditCount={this.props.auditCount}
              bridgeReady={this.props.bridgeReady}
              renderPhase="error_boundary"
              errorMessage={this.state.message}
            />
          </BlockStack>
        </Page>
      );
    }

    return this.props.children;
  }
}
