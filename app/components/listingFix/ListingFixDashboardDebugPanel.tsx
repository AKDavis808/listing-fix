import { Banner, BlockStack, Box, Card, Text } from "@shopify/polaris";

/** Temporary embedded-dashboard diagnostics — remove after blank-body fix is verified. */
export const SHOW_DASHBOARD_DEBUG_PANEL = true;

export function ListingFixDashboardDebugPanel({
  loaderOk,
  productCount,
  auditCount,
  bridgeReady,
  renderPhase,
  errorMessage,
}: {
  loaderOk: boolean;
  productCount: number;
  auditCount: number;
  bridgeReady: boolean;
  renderPhase: string;
  errorMessage?: string | null;
}) {
  if (!SHOW_DASHBOARD_DEBUG_PANEL) return null;

  return (
    <Box paddingBlockStart="400">
      <Card roundedAbove="sm" padding="400">
        <BlockStack gap="200">
          <Banner tone="info" title="Dashboard debug (temporary)">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm">
                loader: {loaderOk ? "ok" : "failed"} · products: {productCount} ·
                audits: {auditCount} · app bridge:{" "}
                {bridgeReady ? "ready" : "waiting"} · phase: {renderPhase}
              </Text>
              {errorMessage ? (
                <Text as="p" variant="bodySm" tone="critical">
                  error: {errorMessage}
                </Text>
              ) : null}
            </BlockStack>
          </Banner>
        </BlockStack>
      </Card>
    </Box>
  );
}
