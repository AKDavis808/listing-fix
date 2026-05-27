import {
  Badge,
  BlockStack,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";

import {
  BETA_USAGE_MESSAGE,
  type ListingFixDailyUsageSnapshot,
} from "../../features/listingFix/usageLimits";

export function ListingFixBetaUsageCard({
  usage,
}: {
  usage: ListingFixDailyUsageSnapshot;
}) {
  return (
    <Card roundedAbove="sm" padding="400">
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          {BETA_USAGE_MESSAGE}
        </Text>
        <InlineStack gap="300" wrap blockAlign="center">
          <Badge tone={usage.scansRemaining === 0 ? "critical" : "info"}>
            {`Scans remaining today: ${usage.scansRemaining}`}
          </Badge>
          <Badge tone={usage.aiRemaining === 0 ? "critical" : "info"}>
            {`AI generations remaining today: ${usage.aiRemaining}`}
          </Badge>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
