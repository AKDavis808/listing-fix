import { BlockStack, Button, Text } from "@shopify/polaris";

import { LEGAL_LINKS } from "../../features/listingFix/trustCopy";

export function ListingFixEmbeddedAuthFallback({
  isEmbedded,
  hasShop,
  oauthInstallUrl,
}: {
  isEmbedded: boolean;
  hasShop: boolean;
  oauthInstallUrl?: string | null;
}) {
  const handleReconnect = () => {
    if (typeof window === "undefined") return;

    if (oauthInstallUrl) {
      const target = window.top && window.top !== window ? window.top : window;
      if (oauthInstallUrl.startsWith("/")) {
        target.location.assign(oauthInstallUrl);
      } else {
        target.location.href = oauthInstallUrl;
      }
      return;
    }

    window.location.reload();
  };

  return (
    <BlockStack gap="300">
      {isEmbedded ? (
        <>
          <Text as="p" variant="bodyMd">
            ListingFix couldn&apos;t connect to your Shopify session inside Admin.
            Shopify needs to refresh your app connection before ListingFix can
            continue.
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {hasShop
              ? "Click Reconnect in Shopify to restore your ListingFix session."
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
            Reconnect in Shopify
          </Button>
          <Button url={LEGAL_LINKS.support} target="_blank" variant="plain">
            Visit support
          </Button>
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}
