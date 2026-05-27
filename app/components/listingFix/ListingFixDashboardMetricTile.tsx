import type { ReactNode } from "react";
import {
  BlockStack,
  Box,
  Card,
  Text,
} from "@shopify/polaris";

export function ListingFixDashboardMetricTile({
  accessibilityHint,
  label,
  selected,
  disabled,
  busy,
  onToggle,
  children,
}: {
  accessibilityHint: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  /** Dim card while background work runs (e.g. catalog revalidation). */
  busy?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`listing-fix-overview-metric${busy ? " listing-fix-overview-metric--busy" : ""}`}
      aria-pressed={selected}
      aria-disabled={disabled ?? false}
      aria-busy={busy ?? false}
      aria-label={accessibilityHint}
      disabled={disabled}
      onClick={onToggle}
    >
      <div className="listing-fix-overview-metric-inner">
        <Card padding="400" roundedAbove="sm">
          <BlockStack gap="150">
            <Box minHeight="1.75rem">{children}</Box>
            <Text variant="bodySm" tone="subdued" as="p">
              {label}
            </Text>
          </BlockStack>
        </Card>
      </div>
    </button>
  );
}
