import { useCallback, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Modal,
  Text,
} from "@shopify/polaris";

import {
  formatScanSessionLabel,
  type CatalogScanSessionSummary,
} from "../../features/listingFix/scanHistoryTypes";

function formatAverageScore(score: number | null): string {
  return score == null ? "—" : String(score);
}

export function ListingFixScanHistoryPanel({
  sessions,
  activeSessionId,
  restoringSessionId,
  onRestore,
}: {
  sessions: CatalogScanSessionSummary[];
  activeSessionId: string | null;
  restoringSessionId: string | null;
  onRestore: (sessionId: string) => void;
}) {
  const [viewSession, setViewSession] = useState<CatalogScanSessionSummary | null>(
    null,
  );

  const closeView = useCallback(() => setViewSession(null), []);

  if (sessions.length === 0) {
    return (
      <Card roundedAbove="sm" padding="500">
        <BlockStack gap="200">
          <Text as="h2" variant="headingSm">
            Scan History
          </Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            Review previous catalog scans and track optimization progress over time.
            Your first saved scan will appear here after you run Scan Products.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <>
      <div className="listing-fix-scan-history">
        <Card roundedAbove="sm" padding="500">
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingSm">
              Recent Scans
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Review previous catalog scans and restore earlier results to compare
              recommendations over time.
            </Text>
          </BlockStack>

          <BlockStack gap="200">
            {sessions.map((session) => {
              const isActive = activeSessionId === session.id;
              const isRestoring = restoringSessionId === session.id;
              const label = formatScanSessionLabel(session.scanCompletedAt);

              return (
                <Box
                  key={session.id}
                  padding="300"
                  className={`listing-fix-scan-history-row${
                    isActive ? " listing-fix-scan-history-row--active" : ""
                  }`}
                >
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    gap="300"
                    wrap
                  >
                    <BlockStack gap="100">
                      <InlineStack gap="200" wrap blockAlign="center">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {label}
                        </Text>
                        {isActive ? (
                          <Badge tone="success">Currently viewing</Badge>
                        ) : null}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {session.scanSummary ??
                          `${session.productCount} products · ${session.issueCount} issues · ${formatAverageScore(session.averageScore)} avg score`}
                      </Text>
                      {session.topIssue ? (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Top issue: {session.topIssue}
                        </Text>
                      ) : null}
                    </BlockStack>

                    <InlineStack gap="200" wrap blockAlign="center">
                      <Button
                        variant="plain"
                        onClick={() => setViewSession(session)}
                      >
                        View Scan
                      </Button>
                      <Button
                        variant="secondary"
                        loading={isRestoring}
                        disabled={Boolean(restoringSessionId && !isRestoring)}
                        onClick={() => onRestore(session.id)}
                      >
                        Restore Results
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </Box>
              );
            })}
          </BlockStack>
        </BlockStack>
      </Card>
      </div>

      <Modal
        open={viewSession != null}
        onClose={closeView}
        title="Scan snapshot"
        primaryAction={{
          content: "Close",
          onAction: closeView,
        }}
        secondaryActions={
          viewSession
            ? [
                {
                  content: "Restore Results",
                  onAction: () => {
                    onRestore(viewSession.id);
                    closeView();
                  },
                },
              ]
            : undefined
        }
      >
        {viewSession ? (
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd">
                {formatScanSessionLabel(viewSession.scanCompletedAt)}
              </Text>
              <InlineStack gap="200" wrap>
                <Badge tone="info">{`${viewSession.productCount} products`}</Badge>
                <Badge tone="attention">{`${viewSession.issueCount} issues`}</Badge>
                <Badge tone="success">{`Avg ${formatAverageScore(viewSession.averageScore)}`}</Badge>
              </InlineStack>
              {viewSession.scanSummary ? (
                <Text as="p" variant="bodyMd" tone="subdued">
                  {viewSession.scanSummary}
                </Text>
              ) : null}
              {viewSession.topIssue ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  Most common issue: {viewSession.topIssue}
                </Text>
              ) : null}
              <Text as="p" variant="bodySm" tone="subdued">
                Restore earlier scan results to browse previous recommendations in
                your current catalog view.
              </Text>
            </BlockStack>
          </Modal.Section>
        ) : null}
      </Modal>
    </>
  );
}
