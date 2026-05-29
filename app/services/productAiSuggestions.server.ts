/**
 * Merchant-triggered AI copy suggestions — server only, suggestion-only (no Shopify writes).
 */

import type { CatalogProductSnapshot } from "./listingProducts.server";
import { openAiChatCompletionJson } from "./openai.server";
import type { IssueRecommendationPair } from "./productRecommendations.server";

export type AiListingImprovements = {
  improvedTitle: string;
  improvedDescription: string;
  seoTitle: string;
  seoDescription: string;
  suggestedTags: string[];
  summary: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdownJsonFence(raw: string): string {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im;
  const m = fence.exec(s);
  if (m?.[1]) s = m[1].trim();
  return s;
}

export function parseAiListingImprovements(
  raw: string,
): { ok: true; value: AiListingImprovements } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownJsonFence(raw));
  } catch {
    return { ok: false, error: "AI response was not valid JSON." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "AI JSON root must be an object." };
  }

  const o = parsed as Record<string, unknown>;
  const improvedTitle =
    typeof o.improvedTitle === "string" ? o.improvedTitle.trim() : "";
  const improvedDescription =
    typeof o.improvedDescription === "string"
      ? o.improvedDescription.trim()
      : "";
  const seoDescription =
    typeof o.seoDescription === "string"
      ? o.seoDescription.trim()
      : typeof (o as { seo_description?: unknown }).seo_description ===
          "string"
        ? String((o as { seo_description: string }).seo_description).trim()
        : "";
  const seoTitleRaw =
    typeof o.seoTitle === "string"
      ? o.seoTitle.trim()
      : typeof (o as { seo_title?: unknown }).seo_title === "string"
        ? String((o as { seo_title: string }).seo_title).trim()
        : "";

  const tagsRaw = o.suggestedTags;
  const suggestedTags = Array.isArray(tagsRaw)
    ? tagsRaw
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 32)
    : [];

  const summary =
    typeof o.summary === "string" ? o.summary.trim() : "";

  if (!improvedTitle || !improvedDescription) {
    return {
      ok: false,
      error: "AI response missing required improvedTitle/improvedDescription.",
    };
  }
  if (!seoDescription) {
    return {
      ok: false,
      error: "AI response missing seoDescription.",
    };
  }
  const seoTitle = seoTitleRaw || improvedTitle;
  if (!summary) {
    return {
      ok: false,
      error: "AI response missing summary.",
    };
  }

  return {
    ok: true,
    value: {
      improvedTitle,
      improvedDescription,
      seoTitle,
      seoDescription,
      suggestedTags,
      summary,
    },
  };
}

const SYSTEM_PROMPT = `You are a professional ecommerce copywriter for Shopify merchants.
Respond with a single JSON object only (no markdown fence, no preamble). Keys must be exactly:
- improvedTitle (string)
- improvedDescription (string): plain language or minimal HTML paragraphs; no markdown.
- seoTitle (string): search listing title for Shopify SEO, concise and factual.
- seoDescription (string): search snippet, target max ~155 characters — never invent claims.
- suggestedTags (array of strings): 5–14 concise storefront tags when helpful; reuse theme of existing tags.
- summary (string): 2–4 sentences explaining what you changed and why, conservative tone.

Rules:
- Preserve factual accuracy; never invent specs, certifications, pricing, guarantees, medical claims, or legal promises.
- Do not contradict the deterministic audit hints; aim to resolve them respectfully where possible.
- Match the merchant language of the supplied title/description where obvious.
- If information is unknown, omit rather than speculate.`;

export async function generateProductListingSuggestions(params: {
  snapshot: CatalogProductSnapshot;
  issues: readonly string[];
  recommendations: readonly IssueRecommendationPair[];
}): Promise<
  | { ok: true; value: AiListingImprovements }
  | { ok: false; error: string }
> {
  const plainDesc = stripHtml(params.snapshot.descriptionHtml ?? "");
  const descSnippet =
    plainDesc.length > 5000 ? `${plainDesc.slice(0, 5000)}…` : plainDesc;

  const userPayload = {
    productTitle: params.snapshot.title,
    productHtmlDescription: params.snapshot.descriptionHtml ?? "",
    productDescriptionPlain: descSnippet,
    productType: params.snapshot.productType || "",
    existingTags: params.snapshot.tags,
    auditIssues: [...params.issues],
    deterministicRecommendations: params.recommendations.map((r) => ({
      issue: r.issue,
      recommendation: r.recommendation,
    })),
  };

  const user = JSON.stringify(userPayload).slice(0, 28000);

  const completion = await openAiChatCompletionJson({
    system: SYSTEM_PROMPT,
    user:
      user +
      `\nProduce JSON only with keys: improvedTitle, improvedDescription, seoTitle, seoDescription, suggestedTags, summary.`,
    temperature: 0.35,
    maxCompletionTokens: 950,
  });

  if (!completion.ok) {
    return { ok: false, error: completion.error };
  }

  return parseAiListingImprovements(completion.rawText);
}
