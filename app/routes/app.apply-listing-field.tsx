import type { ActionFunctionArgs } from "react-router";

import { recordProductFieldApplyLog } from "../features/listingFix/productApplyAudit.server";
import {
  endTimer,
  logListingFixEvent,
  startTimer,
} from "../features/listingFix/telemetry";
import { incrementApplyUsage } from "../features/listingFix/usage.server";
import { authenticate } from "../shopify.server";
import { fetchProductById } from "../services/listingProducts.server";
import {
  applyApprovedListingFields,
  assertProductGid,
  normalizeDescriptionHtmlForShopify,
  updateProductDescription,
  updateProductSeoFields,
  updateProductTags,
  updateProductTitle,
  type ListingFieldBatchInput,
  type ProductFieldUpdateFailure,
  type ProductFieldUpdateResult,
} from "../services/shopifyProductUpdates.server";

export type ApplyListingFieldKind =
  | "title"
  | "description"
  | "tags"
  | "seo"
  | "all";

export type ApplyListingFieldActionData =
  | {
      ok: true;
      productId: string;
      field: ApplyListingFieldKind;
      fieldsUpdated: string[];
      requestToken: string;
    }
  | {
      ok: false;
      errorMessage: string;
      productId: string;
      field: ApplyListingFieldKind;
      userErrors?: ProductFieldUpdateFailure["userErrors"];
      requestToken: string;
    };

const ALLOWED_FIELDS = new Set<ApplyListingFieldKind>([
  "title",
  "description",
  "tags",
  "seo",
  "all",
]);

function extractRequestToken(formData: FormData): string {
  const raw = formData.get("requestToken");
  return typeof raw === "string" ? raw : "";
}

function readString(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : undefined;
}

function logApplyFailure(
  shop: string,
  timer: ReturnType<typeof startTimer>,
  productId: string,
  field: ApplyListingFieldKind,
  message: unknown,
) {
  logListingFixEvent({
    action: "apply_failure",
    shop,
    productId: productId || undefined,
    durationMs: endTimer(timer),
    message,
    meta: { field },
  });
}

async function loadPreviousValues(
  admin: Parameters<typeof fetchProductById>[0],
  productId: string,
) {
  const snapshot = await fetchProductById(admin, productId);
  if (!snapshot) return null;
  return {
    title: snapshot.title,
    descriptionHtml: snapshot.descriptionHtml ?? "",
    "seo.title": snapshot.seoTitle ?? "",
    "seo.description": snapshot.seoDescription ?? "",
    tags: snapshot.tags,
  };
}

function buildNewValuesForAudit(
  field: ApplyListingFieldKind,
  formData: FormData,
  fieldsUpdated: readonly string[],
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};

  if (fieldsUpdated.includes("title")) {
    const title = readString(formData, "title") ?? readString(formData, "value");
    if (title?.trim()) out.title = title.trim();
  }

  if (fieldsUpdated.includes("descriptionHtml")) {
    const description =
      readString(formData, "descriptionHtml") ?? readString(formData, "value");
    if (description?.trim()) {
      out.descriptionHtml = normalizeDescriptionHtmlForShopify(description);
    }
  }

  if (
    fieldsUpdated.includes("seo.title") ||
    fieldsUpdated.includes("seo.description")
  ) {
    const seoTitle = readString(formData, "seoTitle");
    const seoDescription =
      readString(formData, "seoDescription") ?? readString(formData, "value");
    if (seoTitle?.trim()) out["seo.title"] = seoTitle.trim();
    if (seoDescription?.trim()) out["seo.description"] = seoDescription.trim();
  }

  if (fieldsUpdated.includes("tags")) {
    const raw = readString(formData, "tagsJson");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          out.tags = parsed.filter((t): t is string => typeof t === "string");
        }
      } catch {
        // Omit malformed tags from audit payload.
      }
    }
  }

  if (field === "all") {
    const batch: ListingFieldBatchInput = {
      title: readString(formData, "title"),
      descriptionHtml: readString(formData, "descriptionHtml"),
      seoTitle: readString(formData, "seoTitle"),
      seoDescription: readString(formData, "seoDescription"),
    };
    if (batch.title?.trim()) out.title = batch.title.trim();
    if (batch.descriptionHtml?.trim()) {
      out.descriptionHtml = normalizeDescriptionHtmlForShopify(
        batch.descriptionHtml,
      );
    }
    if (batch.seoTitle?.trim()) out["seo.title"] = batch.seoTitle.trim();
    if (batch.seoDescription?.trim()) {
      out["seo.description"] = batch.seoDescription.trim();
    }
  }

  return out;
}

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ApplyListingFieldActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const timer = startTimer("apply-listing-field");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    logApplyFailure(shop, timer, "", "title", error);
    return {
      ok: false,
      errorMessage: "Invalid form submission.",
      productId: "",
      field: "title",
      requestToken: "",
    };
  }

  const requestToken = extractRequestToken(formData);

  if (formData.get("intent") !== "apply-listing-field") {
    logApplyFailure(shop, timer, "", "title", "Unsupported intent.");
    return {
      ok: false,
      errorMessage: "Unsupported intent.",
      productId: "",
      field: "title",
      requestToken,
    };
  }

  const productRaw = formData.get("productId");
  const fieldRaw = formData.get("field");

  const resolvedProduct =
    typeof productRaw === "string" ? assertProductGid(productRaw) : null;
  const resolvedField =
    typeof fieldRaw === "string" && ALLOWED_FIELDS.has(fieldRaw as ApplyListingFieldKind)
      ? (fieldRaw as ApplyListingFieldKind)
      : null;

  if (!resolvedProduct || !resolvedField) {
    logApplyFailure(
      shop,
      timer,
      resolvedProduct ?? "",
      resolvedField ?? "title",
      resolvedProduct
        ? "Unknown listing field reference."
        : "Select a catalog product before applying changes.",
    );
    return {
      ok: false,
      errorMessage: resolvedProduct
        ? "Unknown listing field reference."
        : "Select a catalog product before applying changes.",
      productId: resolvedProduct ?? "",
      field: resolvedField ?? "title",
      requestToken,
    };
  }

  const productId = resolvedProduct;
  const field = resolvedField;

  logListingFixEvent({
    action: "apply_start",
    shop,
    productId,
    meta: { field },
  });

  const previousValues = await loadPreviousValues(admin, productId);

  function finalizeOutcome(
    outcome: ProductFieldUpdateResult,
  ): ApplyListingFieldActionData {
    if (outcome.ok) {
      void incrementApplyUsage(shop).catch(() => {
        // Usage tracking must not block successful Shopify updates.
      });
      void recordProductFieldApplyLog({
        shopDomain: shop,
        productId,
        fieldsApplied: outcome.fieldsUpdated,
        previousValues: previousValues ?? undefined,
        newValues: buildNewValuesForAudit(
          field,
          formData,
          outcome.fieldsUpdated,
        ),
        source: "ai_suggestion_review",
      });
      logListingFixEvent({
        action: "apply_success",
        shop,
        productId,
        durationMs: endTimer(timer),
        meta: { field, fieldsUpdated: outcome.fieldsUpdated },
      });
      return {
        ok: true,
        productId,
        field,
        fieldsUpdated: outcome.fieldsUpdated,
        requestToken,
      };
    }

    logApplyFailure(shop, timer, productId, field, outcome.errorMessage);
    return {
      ok: false,
      errorMessage: outcome.errorMessage,
      userErrors: outcome.userErrors,
      productId,
      field,
      requestToken,
    };
  }

  function missingPayload(message: string): ApplyListingFieldActionData {
    logApplyFailure(shop, timer, productId, field, message);
    return {
      ok: false,
      errorMessage: message,
      productId,
      field,
      requestToken,
    };
  }

  try {
    switch (field) {
      case "title": {
        const value = readString(formData, "value");
        if (!value) {
          return missingPayload("Missing title payload.");
        }
        return finalizeOutcome(
          await updateProductTitle(admin, productId, value),
        );
      }
      case "description": {
        const value = readString(formData, "value");
        if (!value) {
          return missingPayload("Missing description payload.");
        }
        return finalizeOutcome(
          await updateProductDescription(admin, productId, value),
        );
      }
      case "seo": {
        const seoTitle = readString(formData, "seoTitle");
        const seoDescription =
          readString(formData, "seoDescription") ?? readString(formData, "value");
        if (!seoTitle || !seoDescription) {
          return missingPayload("Missing SEO title or description payload.");
        }
        return finalizeOutcome(
          await updateProductSeoFields(
            admin,
            productId,
            seoTitle,
            seoDescription,
          ),
        );
      }
      case "tags": {
        const raw = readString(formData, "tagsJson");
        if (!raw) {
          return missingPayload("Missing tags payload.");
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          logApplyFailure(shop, timer, productId, field, error);
          return {
            ok: false,
            errorMessage: "Could not decode tags.",
            productId,
            field,
            requestToken,
          };
        }

        if (!Array.isArray(parsed)) {
          logApplyFailure(
            shop,
            timer,
            productId,
            field,
            "Tags must be formatted as an array.",
          );
          return {
            ok: false,
            errorMessage: "Tags must be formatted as an array.",
            productId,
            field,
            requestToken,
          };
        }

        const tags = parsed.filter((t): t is string => typeof t === "string");

        return finalizeOutcome(await updateProductTags(admin, productId, tags));
      }
      case "all": {
        const input: ListingFieldBatchInput = {
          title: readString(formData, "title"),
          descriptionHtml: readString(formData, "descriptionHtml"),
          seoTitle: readString(formData, "seoTitle"),
          seoDescription: readString(formData, "seoDescription"),
        };
        return finalizeOutcome(
          await applyApprovedListingFields(admin, productId, input),
        );
      }
    }
  } catch (error) {
    logApplyFailure(shop, timer, productId, field, error);
    return {
      ok: false,
      errorMessage: "Could not apply this change right now.",
      productId,
      field,
      requestToken,
    };
  }
};

/** Action-only companion route — no dedicated UI. */
export default function ApplyListingFieldRouteStub() {
  return null;
}
