import type { ActionFunctionArgs } from "react-router";

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

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<AiSuggestionsActionData> => {
  const { admin } = await authenticate.admin(request);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: "Invalid request body.", requestToken: "" };
  }

  const requestToken = extractAiRequestToken(formData);

  if (formData.get("intent") !== "ai-suggestions") {
    return {
      ok: false,
      error: "Unsupported action intent.",
      requestToken,
    };
  }

  const productIdRaw = formData.get("productId");
  const productId =
    typeof productIdRaw === "string" ? productIdRaw.trim() : "";
  if (!productId) {
    return {
      ok: false,
      error: "A product ID is required.",
      requestToken,
    };
  }

  const snapshot = await fetchProductById(admin, productId);
  if (!snapshot) {
    return {
      ok: false,
      error: "That product could not be loaded — it may no longer exist.",
      productId,
      requestToken,
    };
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
    return {
      ok: false,
      error: generated.error,
      productId: snapshot.id,
      requestToken,
    };
  }

  return {
    ok: true,
    productId: snapshot.id,
    suggestions: generated.value,
    requestToken,
  };
};

/** POST-only companion route; accidental GET renders nothing inline. */
export default function AiSuggestionsResource() {
  return null;
}
