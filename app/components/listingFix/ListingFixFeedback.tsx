import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useFetcher, useLocation } from "react-router";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  ChoiceList,
  InlineStack,
  Modal,
  Text,
  TextField,
} from "@shopify/polaris";

import type { BetaFeedbackActionData } from "../../routes/app.feedback";
import {
  FEEDBACK_SUCCESS_MESSAGE,
  FEEDBACK_TYPE_OPTIONS,
  MAX_FEEDBACK_MESSAGE_LENGTH,
  type BetaFeedbackType,
} from "../../features/listingFix/feedbackTypes";
import { LEGAL_LINKS } from "../../features/listingFix/trustCopy";
import { ListingFixLegalLinks } from "./ListingFixLegalLinks";

type ListingFixFeedbackContextValue = {
  openFeedback: (initialType?: BetaFeedbackType) => void;
  closeFeedback: () => void;
};

const ListingFixFeedbackContext =
  createContext<ListingFixFeedbackContextValue | null>(null);

export function useListingFixFeedback(): ListingFixFeedbackContextValue {
  const context = useContext(ListingFixFeedbackContext);
  if (!context) {
    throw new Error(
      "useListingFixFeedback must be used within ListingFixFeedbackProvider",
    );
  }
  return context;
}

function ListingFixFeedbackModal({
  open,
  onClose,
  shop,
  initialType,
}: {
  open: boolean;
  onClose: () => void;
  shop: string;
  initialType?: BetaFeedbackType;
}) {
  const location = useLocation();
  const fetcher = useFetcher<BetaFeedbackActionData>();

  const [feedbackType, setFeedbackType] = useState<BetaFeedbackType>("general_feedback");
  const [message, setMessage] = useState("");
  const [optionalEmail, setOptionalEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitting = fetcher.state !== "idle";
  const response = fetcher.state === "idle" ? fetcher.data : null;

  const resetForm = useCallback(() => {
    setFeedbackType("general_feedback");
    setMessage("");
    setOptionalEmail("");
    setSubmitted(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    resetForm();
    onClose();
  }, [onClose, resetForm, submitting]);

  useEffect(() => {
    if (!open) return;
    if (initialType) {
      setFeedbackType(initialType);
    }
  }, [initialType, open]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !response) return;
    if (response.ok) {
      setSubmitted(true);
    }
  }, [fetcher.state, response]);

  const handleSubmit = useCallback(() => {
    if (submitting || submitted) return;

    const form = new FormData();
    form.set("intent", "beta-feedback");
    form.set("feedbackType", feedbackType);
    form.set("message", message);
    form.set("optionalEmail", optionalEmail);
    form.set("currentRoute", location.pathname);
    form.set(
      "browserInfo",
      typeof navigator !== "undefined"
        ? navigator.userAgent.slice(0, 512)
        : "",
    );

    fetcher.submit(form, {
      method: "post",
      action: "/app/feedback",
    });
  }, [
    feedbackType,
    fetcher,
    location.pathname,
    message,
    optionalEmail,
    submitted,
    submitting,
  ]);

  const errorMessage =
    response && !response.ok ? response.error : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Beta Feedback"
      primaryAction={
        submitted
          ? {
              content: "Close",
              onAction: handleClose,
            }
          : {
              content: "Send Feedback",
              onAction: handleSubmit,
              loading: submitting,
              disabled: submitting || message.trim().length < 8,
            }
      }
      secondaryActions={
        submitted
          ? undefined
          : [
              {
                content: "Cancel",
                onAction: handleClose,
                disabled: submitting,
              },
            ]
      }
    >
      <Modal.Section>
        {submitted ? (
          <Banner tone="success" title="Feedback received">
            <Text as="p" variant="bodyMd">
              {FEEDBACK_SUCCESS_MESSAGE}
            </Text>
          </Banner>
        ) : (
          <BlockStack gap="400">
            <Text as="p" variant="bodySm" tone="subdued">
              Share bugs, ideas, or anything confusing during beta testing. Your
              shop ({shop}) is included automatically so we can follow up if needed.
            </Text>

            {errorMessage ? (
              <Banner tone="critical" title="Couldn't send feedback">
                <Text as="p" variant="bodyMd">
                  {errorMessage}
                </Text>
              </Banner>
            ) : null}

            <ChoiceList
              title="Feedback type"
              choices={FEEDBACK_TYPE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              selected={[feedbackType]}
              onChange={(selected) => {
                const next = selected[0];
                if (typeof next === "string") {
                  setFeedbackType(next as BetaFeedbackType);
                }
              }}
            />

            <TextField
              label="Message"
              value={message}
              onChange={setMessage}
              multiline={5}
              autoComplete="off"
              maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
              showCharacterCount
              placeholder="Tell us what happened, what you expected, or what would help."
            />

            <TextField
              label="Email (optional)"
              value={optionalEmail}
              onChange={setOptionalEmail}
              type="email"
              autoComplete="email"
              helpText="Optional — only if you'd like us to reply."
            />
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

export function ListingFixFeedbackProvider({
  shop,
  children,
}: {
  shop: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [initialType, setInitialType] = useState<BetaFeedbackType | undefined>();

  const value = useMemo(
    () => ({
      openFeedback: (type?: BetaFeedbackType) => {
        setInitialType(type);
        setOpen(true);
      },
      closeFeedback: () => setOpen(false),
    }),
    [],
  );

  return (
    <ListingFixFeedbackContext.Provider value={value}>
      {children}
      <ListingFixFeedbackModal
        open={open}
        onClose={() => {
          setOpen(false);
          setInitialType(undefined);
        }}
        shop={shop}
        initialType={initialType}
      />
    </ListingFixFeedbackContext.Provider>
  );
}

export function ListingFixFeedbackFooter() {
  const { openFeedback } = useListingFixFeedback();

  return (
    <Box padding="400" className="listing-fix-feedback-footer">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text as="p" variant="bodySm" tone="subdued">
            ListingFix Beta — feedback helps us improve stability and clarity.
          </Text>
          <InlineStack gap="200" wrap>
            <Button variant="plain" onClick={openFeedback}>
              Send Feedback
            </Button>
            <Button variant="plain" onClick={() => openFeedback("bug")}>
              Report an Issue
            </Button>
            <Button
              variant="plain"
              url={LEGAL_LINKS.support}
              target="_blank"
            >
              Support
            </Button>
          </InlineStack>
        </InlineStack>
        <ListingFixLegalLinks />
      </BlockStack>
    </Box>
  );
}
