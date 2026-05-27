import type { ActionFunctionArgs } from "react-router";

import { submitBetaFeedback } from "../features/listingFix/feedback.server";
import { authenticate } from "../shopify.server";

export type BetaFeedbackActionData =
  | { ok: true }
  | { ok: false; error: string };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<BetaFeedbackActionData> => {
  const { session } = await authenticate.admin(request);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: "Invalid feedback submission." };
  }

  if (formData.get("intent") !== "beta-feedback") {
    return { ok: false, error: "Unsupported feedback action." };
  }

  const result = await submitBetaFeedback({
    shopDomain: session.shop,
    feedbackType: String(formData.get("feedbackType") ?? ""),
    message: String(formData.get("message") ?? ""),
    optionalEmail: String(formData.get("optionalEmail") ?? ""),
    currentRoute: String(formData.get("currentRoute") ?? ""),
    browserInfo: String(formData.get("browserInfo") ?? ""),
  });

  return result.ok ? { ok: true } : { ok: false, error: result.error };
};

/** POST-only feedback route. */
export default function BetaFeedbackRouteStub() {
  return null;
}
