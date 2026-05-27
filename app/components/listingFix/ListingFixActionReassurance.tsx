import { Text } from "@shopify/polaris";

export function ListingFixActionReassurance({ message }: { message: string }) {
  return (
    <div className="listing-fix-action-reassurance">
      <Text as="p" variant="bodySm" tone="subdued">
        {message}
      </Text>
    </div>
  );
}
