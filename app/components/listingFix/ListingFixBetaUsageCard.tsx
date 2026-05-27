import {
  Badge,
  BlockStack,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";

import { BETA_USAGE_MESSAGE } from "../../features/listingFix/usageLimits";
import type { ListingFixDailyUsageSnapshot } from "../../features/listingFix/usageLimits";
import { BETA_FOOTER_LINES } from "../../features/listingFix/trustCopy";
import { ListingFixBetaBadge } from "./ListingFixBetaBadge";

export function ListingFixBetaUsageCard({
  usage,
}: {
  usage: ListingFixDailyUsageSnapshot;
}) {
  return (
    <div className="listing-fix-beta-usage-card">
      <Card roundedAbove="sm" padding="400">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <ListingFixBetaBadge />
          <InlineStack gap="200" wrap blockAlign="center">
            <Badge tone={usage.scansRemaining === 0 ? "critical" : "info"}>
              {`Scans remaining today: ${usage.scansRemaining}`}
            </Badge>
            <Badge tone={usage.aiRemaining === 0 ? "critical" : "info"}>
              {`AI generations remaining today: ${usage.aiRemaining}`}
            </Badge>
          </InlineStack>
        </InlineStack>
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">
            {BETA_USAGE_MESSAGE}
          </Text>
          {BETA_FOOTER_LINES.map((line) => (
            <Text key={line} as="p" variant="bodySm" tone="subdued">
              {line}
            </Text>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
    </div>
  );
}
