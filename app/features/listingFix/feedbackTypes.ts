export const LISTING_FIX_APP_VERSION = "beta";

export const FEEDBACK_TYPE_OPTIONS = [
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "Feature Request" },
  { value: "improvement_idea", label: "Improvement Idea" },
  { value: "general_feedback", label: "General Feedback" },
] as const;

export type BetaFeedbackType =
  (typeof FEEDBACK_TYPE_OPTIONS)[number]["value"];

export const FEEDBACK_SUCCESS_MESSAGE =
  "Thanks for helping improve ListingFix beta.";

export const FEEDBACK_EMPTY_MESSAGE =
  "Please share a few details so we can understand your feedback.";

export const FEEDBACK_COOLDOWN_MESSAGE =
  "Please wait a moment before sending more feedback.";

export const MAX_FEEDBACK_MESSAGE_LENGTH = 2000;
export const MAX_FEEDBACK_EMAIL_LENGTH = 320;
export const FEEDBACK_COOLDOWN_MS = 15_000;

export function isBetaFeedbackType(value: string): value is BetaFeedbackType {
  return FEEDBACK_TYPE_OPTIONS.some((option) => option.value === value);
}
