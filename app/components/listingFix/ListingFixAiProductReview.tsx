import type { ReactNode } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";

import { ListingFixActionReassurance } from "./ListingFixActionReassurance";
import { REASSURANCE } from "../../features/listingFix/trustCopy";
import type { ApplyListingFieldKind } from "../../routes/app.apply-listing-field";
import type { ProductListingCurrentValues } from "../../routes/app.ai-suggestions";

export type EditableListingSuggestions = {
  improvedTitle: string;
  improvedDescription: string;
  seoTitle: string;
  seoDescription: string;
  suggestedTags: string[];
  summary: string;
};

function stripHtmlForDisplay(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function displayCurrentValue(value: string, mode: "plain" | "html"): string {
  const trimmed = value.trim();
  if (!trimmed.length) return "—";
  return mode === "html" ? stripHtmlForDisplay(trimmed) : trimmed;
}

function ListingFieldReviewBlock({
  label,
  currentValue,
  currentMode = "plain",
  suggestedValue,
  onSuggestedChange,
  editable = true,
  multiline = false,
  applyLabel,
  applyBusy,
  applySuccessPulse,
  disableApply,
  onApply,
  footnote,
}: {
  label: string;
  currentValue: string;
  currentMode?: "plain" | "html";
  suggestedValue: string;
  onSuggestedChange?: (next: string) => void;
  editable?: boolean;
  multiline?: boolean;
  applyLabel: string;
  applyBusy?: boolean;
  applySuccessPulse?: boolean;
  disableApply?: boolean;
  onApply?: () => void;
  footnote?: ReactNode;
}) {
  const canApply = typeof onApply === "function";

  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
        <BlockStack gap="050">
          <InlineStack gap="200" wrap blockAlign="center">
            <Text variant="headingSm" as="h4">
              {label}
            </Text>
            {applySuccessPulse ? <Badge tone="success">Synced</Badge> : null}
          </InlineStack>
          {footnote ? (
            <Box maxWidth="620px">
              <Text as="p" variant="bodySm" tone="subdued">
                {footnote}
              </Text>
            </Box>
          ) : null}
        </BlockStack>
        {canApply ? (
          <Button
            size="slim"
            variant="primary"
            loading={applyBusy}
            disabled={Boolean(disableApply || applyBusy)}
            onClick={() => onApply?.()}
          >
            {applyLabel}
          </Button>
        ) : null}
      </InlineStack>

      {canApply ? (
        <ListingFixActionReassurance message={REASSURANCE.apply} />
      ) : null}

      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
            Current
          </Text>
          <Card padding="400">
            <Text as="p" variant="bodyMd" breakWord>
              {displayCurrentValue(currentValue, currentMode)}
            </Text>
          </Card>
        </BlockStack>

        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
            Suggested
          </Text>
          {editable && typeof onSuggestedChange === "function" ? (
            <TextField
              label={`Suggested ${label.toLowerCase()}`}
              labelHidden
              value={suggestedValue}
              onChange={onSuggestedChange}
              multiline={multiline ? 4 : undefined}
              autoComplete="off"
            />
          ) : (
            <Card padding="400">
              <Text as="p" variant="bodyMd" breakWord>
                {suggestedValue.trim().length
                  ? suggestedValue
                  : "No suggestion provided."}
              </Text>
            </Card>
          )}
        </BlockStack>
      </InlineGrid>
    </BlockStack>
  );
}

export function ListingFixAiProductReview({
  currentValues,
  suggestions,
  onSuggestionsChange,
  applyInFlight,
  applySuccessBadgeField,
  isListingFieldApplyBusy,
  onApplyField,
  onApplyAll,
  onSkip,
}: {
  currentValues: ProductListingCurrentValues;
  suggestions: EditableListingSuggestions;
  onSuggestionsChange: (next: EditableListingSuggestions) => void;
  applyInFlight: boolean;
  applySuccessBadgeField: ApplyListingFieldKind | null;
  isListingFieldApplyBusy: (kind: ApplyListingFieldKind) => boolean;
  onApplyField: (
    field: ApplyListingFieldKind,
    buildPayload: () => FormData | null,
  ) => void;
  onApplyAll: () => void;
  onSkip: () => void;
}) {
  const titleReady = suggestions.improvedTitle.trim().length > 0;
  const descriptionReady = suggestions.improvedDescription.trim().length > 0;
  const seoReady =
    suggestions.seoTitle.trim().length > 0 &&
    suggestions.seoDescription.trim().length > 0;
  const applyAllReady = titleReady && descriptionReady && seoReady;

  return (
    <BlockStack gap="500">
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">
          Overview
        </Text>
        <Card padding="400">
          <Text as="p" variant="bodyMd" breakWord>
            {suggestions.summary}
          </Text>
        </Card>
      </BlockStack>

      <InlineStack gap="200" wrap blockAlign="center">
        <Button
          variant="primary"
          loading={isListingFieldApplyBusy("all")}
          disabled={!applyAllReady || applyInFlight}
          onClick={onApplyAll}
        >
          Apply all selected fields
        </Button>
        <Button variant="secondary" disabled={applyInFlight} onClick={onSkip}>
          Skip review
        </Button>
      </InlineStack>

      <ListingFieldReviewBlock
        label="Title"
        currentValue={currentValues.title}
        suggestedValue={suggestions.improvedTitle}
        onSuggestedChange={(improvedTitle) =>
          onSuggestionsChange({ ...suggestions, improvedTitle })
        }
        applyLabel="Apply title"
        applyBusy={isListingFieldApplyBusy("title")}
        applySuccessPulse={
          applySuccessBadgeField === "title" || applySuccessBadgeField === "all"
        }
        disableApply={!titleReady || applyInFlight}
        onApply={() =>
          onApplyField("title", () => {
            const fd = new FormData();
            fd.set("value", suggestions.improvedTitle);
            return fd;
          })
        }
      />

      <ListingFieldReviewBlock
        label="Description"
        currentValue={currentValues.descriptionHtml}
        currentMode="html"
        suggestedValue={suggestions.improvedDescription}
        onSuggestedChange={(improvedDescription) =>
          onSuggestionsChange({ ...suggestions, improvedDescription })
        }
        multiline
        applyLabel="Apply description"
        applyBusy={isListingFieldApplyBusy("description")}
        applySuccessPulse={
          applySuccessBadgeField === "description" ||
          applySuccessBadgeField === "all"
        }
        disableApply={!descriptionReady || applyInFlight}
        onApply={() =>
          onApplyField("description", () => {
            const fd = new FormData();
            fd.set("value", suggestions.improvedDescription);
            return fd;
          })
        }
      />

      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
          <BlockStack gap="050">
            <InlineStack gap="200" wrap blockAlign="center">
              <Text variant="headingSm" as="h4">
                SEO
              </Text>
              {applySuccessBadgeField === "seo" ||
              applySuccessBadgeField === "all" ? (
                <Badge tone="success">Synced</Badge>
              ) : null}
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Updates the search listing title and meta description in Shopify
              admin.
            </Text>
          </BlockStack>
          <Button
            size="slim"
            variant="primary"
            loading={isListingFieldApplyBusy("seo")}
            disabled={!seoReady || applyInFlight}
            onClick={() =>
              onApplyField("seo", () => {
                const fd = new FormData();
                fd.set("seoTitle", suggestions.seoTitle);
                fd.set("seoDescription", suggestions.seoDescription);
                return fd;
              })
            }
          >
            Apply SEO
          </Button>
        </InlineStack>

        <ListingFixActionReassurance message={REASSURANCE.apply} />

        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
          <BlockStack gap="200">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                Current SEO title
              </Text>
              <Card padding="400">
                <Text as="p" variant="bodyMd" breakWord>
                  {displayCurrentValue(currentValues.seoTitle, "plain")}
                </Text>
              </Card>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                Current SEO description
              </Text>
              <Card padding="400">
                <Text as="p" variant="bodyMd" breakWord>
                  {displayCurrentValue(currentValues.seoDescription, "plain")}
                </Text>
              </Card>
            </BlockStack>
          </BlockStack>

          <BlockStack gap="200">
            <TextField
              label="Suggested SEO title"
              value={suggestions.seoTitle}
              onChange={(seoTitle) =>
                onSuggestionsChange({ ...suggestions, seoTitle })
              }
              autoComplete="off"
            />
            <TextField
              label="Suggested SEO description"
              value={suggestions.seoDescription}
              onChange={(seoDescription) =>
                onSuggestionsChange({ ...suggestions, seoDescription })
              }
              multiline={3}
              autoComplete="off"
            />
          </BlockStack>
        </InlineGrid>
      </BlockStack>

      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
          <BlockStack gap="050">
            <InlineStack gap="200" wrap blockAlign="center">
              <Text variant="headingSm" as="h4">
                Tags
              </Text>
              {applySuccessBadgeField === "tags" ? (
                <Badge tone="success">Synced</Badge>
              ) : null}
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Applying replaces every tag currently on this product — preview in
              Shopify afterward if unsure.
            </Text>
          </BlockStack>

          <InlineStack gap="200" wrap blockAlign="center">
            <Button
              variant="primary"
              size="slim"
              loading={isListingFieldApplyBusy("tags")}
              disabled={
                suggestions.suggestedTags.length === 0 || applyInFlight
              }
              onClick={() =>
                onApplyField("tags", () => {
                  const fd = new FormData();
                  fd.set(
                    "tagsJson",
                    JSON.stringify(suggestions.suggestedTags),
                  );
                  return fd;
                })
              }
            >
              Apply tags
            </Button>
            <Button
              variant="secondary"
              size="slim"
              disabled={suggestions.suggestedTags.length === 0}
              onClick={() =>
                void navigator.clipboard.writeText(
                  suggestions.suggestedTags.join(", "),
                )
              }
            >
              Copy all
            </Button>
          </InlineStack>
        </InlineStack>
        <ListingFixActionReassurance message={REASSURANCE.apply} />

        {suggestions.suggestedTags.length === 0 ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            No alternate tags surfaced — reuse your existing tagging approach.
          </Text>
        ) : (
          <InlineStack gap="150" wrap>
            {suggestions.suggestedTags.map((tag, index) => (
              <Badge key={`${tag}-${index}`}>{tag}</Badge>
            ))}
          </InlineStack>
        )}
      </BlockStack>
    </BlockStack>
  );
}
