import {
  BlockStack,
  Box,
  Card,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  List,
  Text,
} from "@shopify/polaris";
import {
  MagicIcon,
  ProductIcon,
  SearchIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";

import {
  LISTING_FIX_BETA_LABEL,
  TRUST_PANEL_POINTS,
  TRUST_PANEL_TITLE,
  TRUST_SECTIONS,
} from "../../features/listingFix/trustCopy";
import { ListingFixBetaBadge } from "./ListingFixBetaBadge";

const SECTION_ICONS = [SearchIcon, ProductIcon, MagicIcon, ShieldCheckMarkIcon];

export function ListingFixTrustPanel() {
  return (
    <Box className="listing-fix-trust-panel">
      <Card roundedAbove="sm" padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <Text as="h2" variant="headingMd">
              {TRUST_PANEL_TITLE}
            </Text>
            <ListingFixBetaBadge />
          </InlineStack>

          <List type="bullet" gap="loose">
            {TRUST_PANEL_POINTS.map((point) => (
              <List.Item key={point}>
                <Text as="span" variant="bodyMd">
                  {point}
                </Text>
              </List.Item>
            ))}
          </List>

          <Divider />

          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
            {TRUST_SECTIONS.map((section, index) => {
              const SectionIcon = SECTION_ICONS[index] ?? SearchIcon;
              return (
                <Box
                  key={section.title}
                  padding="300"
                  className="listing-fix-trust-section"
                >
                  <BlockStack gap="150">
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <span className="listing-fix-trust-section-icon" aria-hidden>
                        <Icon source={SectionIcon} tone="success" />
                      </span>
                      <Text as="h3" variant="headingSm">
                        {section.title}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {section.body}
                    </Text>
                  </BlockStack>
                </Box>
              );
            })}
          </InlineGrid>
        </BlockStack>
      </Card>
    </Box>
  );
}
