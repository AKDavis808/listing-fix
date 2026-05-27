import type { ReactNode } from "react";
import { Component } from "react";
import { Banner, BlockStack, Page, Text } from "@shopify/polaris";

import { logListingFixEvent } from "../../features/listingFix/telemetry";

type Props = {
  children: ReactNode;
  shop?: string | null;
};

type State = {
  hasError: boolean;
};

export class ListingFixErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    logListingFixEvent({
      action: "runtime_error",
      shop: this.props.shop,
      message: error,
      meta: {
        boundary: "ListingFixErrorBoundary",
        componentStack: info.componentStack?.slice(0, 600) ?? null,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <Page title="ListingFix">
          <BlockStack gap="400">
            <Banner tone="critical" title="Something went wrong">
              <Text as="p" variant="bodyMd">
                ListingFix hit an unexpected error. Reload this page to continue.
                If the problem persists, try again in a few minutes.
              </Text>
            </Banner>
          </BlockStack>
        </Page>
      );
    }

    return this.props.children;
  }
}
