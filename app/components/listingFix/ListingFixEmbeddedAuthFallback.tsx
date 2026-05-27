import { BlockStack, Button, Text } from "@shopify/polaris";

import { LEGAL_LINKS } from "../../features/listingFix/trustCopy";

export function ListingFixEmbeddedAuthFallback({
  isEmbedded,
  hasShop,
}: {
  isEmbedded: boolean;
  hasShop: boolean;
}) {
  const handleReconnect = () => {
    if (typeof window === "undefined") return;
    window.location.reload();
  };

  return (
    <BlockStack gap="300">
      {isEmbedded ? (
        <>
          <Text as="p" variant="bodyMd">
            ListingFix couldn&apos;t connect to your Shopify session inside Admin.
            This usually resolves with a quick refresh.
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {hasShop
              ? "We detected your shop and will try to reconnect automatically."
              : "Open ListingFix again from Apps in Shopify Admin if the issue continues."}
          </Text>
        </>
      ) : (
        <Text as="p" variant="bodyMd">
          Enter your shop domain below to sign in to ListingFix.
        </Text>
      )}

      {isEmbedded ? (
        <BlockStack gap="200">
          <Button variant="primary" onClick={handleReconnect}>
            Reconnect in Shopify Admin
          </Button>
          <Button url={LEGAL_LINKS.support} target="_blank" variant="plain">
            Visit support
          </Button>
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}
