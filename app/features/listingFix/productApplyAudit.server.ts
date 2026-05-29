import db from "../../db.server";

export type ProductApplyAuditValues = Record<
  string,
  string | string[] | null | undefined
>;

export async function recordProductFieldApplyLog(params: {
  shopDomain: string;
  productId: string;
  fieldsApplied: string[];
  previousValues?: ProductApplyAuditValues;
  newValues?: ProductApplyAuditValues;
  source?: string;
}): Promise<void> {
  try {
    await db.productFieldApplyLog.create({
      data: {
        shopDomain: params.shopDomain,
        productId: params.productId,
        fieldsApplied: params.fieldsApplied,
        previousValues: params.previousValues ?? undefined,
        newValues: params.newValues ?? undefined,
        source: params.source ?? "ai_suggestion_review",
      },
    });
  } catch {
    // Audit logging must not block merchant apply actions.
  }
}
