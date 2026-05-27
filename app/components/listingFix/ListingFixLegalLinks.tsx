import { InlineStack, Link, Text } from "@shopify/polaris";

import { LEGAL_LINKS } from "../../features/listingFix/trustCopy";

export function ListingFixLegalLinks() {
  return (
    <InlineStack gap="300" wrap blockAlign="center">
      <Link url={LEGAL_LINKS.privacy} target="_blank">
        Privacy
      </Link>
      <Text as="span" variant="bodySm" tone="subdued" aria-hidden>
        ·
      </Text>
      <Link url={LEGAL_LINKS.terms} target="_blank">
        Terms
      </Link>
      <Text as="span" variant="bodySm" tone="subdued" aria-hidden>
        ·
      </Text>
      <Link url={LEGAL_LINKS.support} target="_blank">
        Support
      </Link>
    </InlineStack>
  );
}
