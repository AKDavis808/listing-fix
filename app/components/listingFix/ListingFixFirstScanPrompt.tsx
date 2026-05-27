import {
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";

import { ListingFixActionReassurance } from "./ListingFixActionReassurance";
import {
  FIRST_SCAN_BODY,
  FIRST_SCAN_HEADING,
  REASSURANCE,
} from "../../features/listingFix/trustCopy";

export function ListingFixFirstScanPrompt({
  scanning,
  disabled,
  onScan,
}: {
  scanning: boolean;
  disabled: boolean;
  onScan: () => void;
}) {
  return (
    <Box className="listing-fix-first-scan-prompt">
      <Card roundedAbove="sm" padding="500">
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {FIRST_SCAN_HEADING}
          </Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            {FIRST_SCAN_BODY}
          </Text>
          <ListingFixActionReassurance message={REASSURANCE.scan} />
          <InlineStack gap="300" wrap blockAlign="center">
            <Button
              variant="primary"
              loading={scanning}
              disabled={disabled}
              onClick={onScan}
            >
              Scan Products
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Box>
  );
}
