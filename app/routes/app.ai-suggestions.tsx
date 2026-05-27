import type { ActionFunctionArgs } from "react-router";

import {
  endTimer,
  logListingFixEvent,
  startTimer,
} from "../features/listingFix/telemetry";
import { authenticate } from "../shopify.server";
import { auditProduct } from "../services/productAudit.server";
import { fetchProductById } from "../services/listingProducts.server";
import { generateProductListingSuggestions } from "../services/productAiSuggestions.server";
import { recommendationsForIssues } from "../services/productRecommendations.server";

export type AiSuggestionsActionData =
  | {
      ok: true;
      productId: string;
      suggestions: {
        improvedTitle: string;
        improvedDescription: string;
        seoDescription: string;
        suggestedTags: string[];
        summary: string;
      };
      requestToken: string;
    }
  | { ok: false; error: string; productId?: string; requestToken: string };

function extractAiRequestToken(formData: FormData): string {
  const raw = formData.get("requestToken");
  return typeof raw === "string" ? raw : "";
}

function failAi(
  shop: string,
  timer: ReturnType<typeof startTimer>,
  error: unknown,
  productId?: string,
  requestToken = "",
): AiSuggestionsActionData {
  const message =
    typeof error === "string"
      ? error
      : error != null && typeof (error as { message?: unknown }).message === "string"
        ? String((error as { message: string }).message)
        : "AI request failed.";

  logListingFixEvent({
    action: "ai_failure",
    shop,
    productId,
    durationMs: endTimer(timer),
    message,
  });

  return { ok: false, error: message, productId, requestToken };
}

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<AiSuggestionsActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const timer = startTimer("ai-suggestions");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return failAi(shop, timer, error);
  }

  const requestToken = extractAiRequestToken(formData);

  if (formData.get("intent") !== "ai-suggestions") {
    return failAi(shop, timer, "Unsupported action intent.", undefined, requestToken);
  }

  const productIdRaw = formData.get("productId");
  const productId =
    typeof productIdRaw === "string" ? productIdRaw.trim() : "";
  if (!productId) {
    return failAi(shop, timer, "A product ID is required.", undefined, requestToken);
  }

  logListingFixEvent({
    action: "ai_start",
    shop,
    productId,
  });

  try {
    const snapshot = await fetchProductById(admin, productId);
    if (!snapshot) {
      return failAi(
        shop,
        timer,
        "That product could not be loaded — it may no longer exist.",
        productId,
        requestToken,
      );
    }

    const audit = auditProduct({
      title: snapshot.title,
      descriptionHtml: snapshot.descriptionHtml,
      productType: snapshot.productType,
      tags: snapshot.tags,
      variantsCount: snapshot.variantsCount,
    });

    const recommendations = recommendationsForIssues(audit.issues);

    const generated = await generateProductListingSuggestions({
      snapshot,
      issues: audit.issues,
      recommendations,
    });

    if (!generated.ok) {
      return failAi(
        shop,
        timer,
        generated.error,
        snapshot.id,
        requestToken,
      );
    }

    logListingFixEvent({
      action: "ai_success",
      shop,
      productId: snapshot.id,
      durationMs: endTimer(timer),
    });

    return {
      ok: true,
      productId: snapshot.id,
      suggestions: generated.value,
      requestToken,
    };
  } catch (error) {
    return failAi(shop, timer, error, productId, requestToken);
  }
};

/** POST-only companion route; accidental GET renders nothing inline. */
export default function AiSuggestionsResource() {
  return null;
}
