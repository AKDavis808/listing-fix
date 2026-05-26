/**
 * Deterministic listing quality audit (no AI, no persistence).
 * Penalties are applied in isolation; `topIssue` reflects the highest-severity rule.
 */

export type ProductAuditInput = {
  title: string;
  descriptionHtml: string | null;
  productType: string;
  tags: string[];
  variantsCount: number;
};

export type ProductAuditOutcome = {
  score: number;
  issues: string[];
  topIssue: string;
};

const MSGS = {
  missingDescription: "Missing product description",
  descriptionTooShort: "Description too short",
  noTags: "No tags",
  weakTitle: "Weak product title",
  missingProductType: "Missing product type",
  noVariants: "No variants configured",
} as const;

/** Issue labels surfaced in audits — keep aligned with recommendation copy. */
export const auditIssueMessages = MSGS;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type WeightedIssue = { message: string; penalty: number };

/** Higher penalty sorts first when picking the displayed “top issue”. */
export function auditProduct(input: ProductAuditInput): ProductAuditOutcome {
  let score = 100;
  const weighted: WeightedIssue[] = [];

  const title = (input.title ?? "").trim();
  const plainDescription = stripHtml(input.descriptionHtml ?? "");
  const hasDescription = plainDescription.length > 0;

  if (!hasDescription) {
    score -= 25;
    weighted.push({ message: MSGS.missingDescription, penalty: 25 });
  } else if (plainDescription.length < 150) {
    score -= 15;
    weighted.push({ message: MSGS.descriptionTooShort, penalty: 15 });
  }

  const typeTrimmed = (input.productType ?? "").trim();
  if (!typeTrimmed) {
    score -= 10;
    weighted.push({ message: MSGS.missingProductType, penalty: 10 });
  }

  const tagCount = input.tags.filter(
    (t) => typeof t === "string" && t.trim().length > 0,
  ).length;

  if (tagCount === 0) {
    score -= 15;
    weighted.push({ message: MSGS.noTags, penalty: 15 });
  }

  if (title.length < 20) {
    score -= 10;
    weighted.push({ message: MSGS.weakTitle, penalty: 10 });
  }

  if (input.variantsCount <= 0) {
    score -= 5;
    weighted.push({ message: MSGS.noVariants, penalty: 5 });
  }

  const clamped = Math.max(0, Math.min(100, score));

  weighted.sort((a, b) => {
    if (b.penalty !== a.penalty) return b.penalty - a.penalty;
    return a.message.localeCompare(b.message);
  });

  const issues = weighted.map((w) => w.message);
  const topIssue =
    weighted.length === 0 ? "" : (weighted[0]?.message ?? "");

  return {
    score: clamped,
    issues,
    topIssue,
  };
}
