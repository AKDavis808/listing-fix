import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  assertProductGid,
  updateProductDescription,
  updateProductSEO,
  updateProductTags,
  updateProductTitle,
  type ProductFieldUpdateFailure,
  type ProductFieldUpdateResult,
} from "../services/shopifyProductUpdates.server";

export type ApplyListingFieldKind = "title" | "description" | "tags" | "seo";

export type ApplyListingFieldActionData =
  | {
      ok: true;
      productId: string;
      field: ApplyListingFieldKind;
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

function extractRequestToken(formData: FormData): string {
  const raw = formData.get("requestToken");
  return typeof raw === "string" ? raw : "";
}

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ApplyListingFieldActionData> => {
  const { admin } = await authenticate.admin(request);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
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
    fieldRaw === "title" ||
    fieldRaw === "description" ||
    fieldRaw === "tags" ||
    fieldRaw === "seo"
      ? fieldRaw
      : null;

  if (!resolvedProduct || !resolvedField) {
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

  function finalizeOutcome(
    outcome: ProductFieldUpdateResult,
  ): ApplyListingFieldActionData {
    if (outcome.ok) {
      return { ok: true, productId, field, requestToken };
    }
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
    return {
      ok: false,
      errorMessage: message,
      productId,
      field,
      requestToken,
    };
  }

  switch (field) {
    case "title": {
      const value = formData.get("value");
      if (typeof value !== "string") {
        return missingPayload("Missing title payload.");
      }
      return finalizeOutcome(
        await updateProductTitle(admin, productId, value),
      );
    }
    case "description": {
      const value = formData.get("value");
      if (typeof value !== "string") {
        return missingPayload("Missing description payload.");
      }
      return finalizeOutcome(
        await updateProductDescription(admin, productId, value),
      );
    }
    case "seo": {
      const value = formData.get("value");
      if (typeof value !== "string") {
        return missingPayload("Missing SEO description payload.");
      }
      return finalizeOutcome(await updateProductSEO(admin, productId, value));
    }
    case "tags": {
      const raw = formData.get("tagsJson");
      if (typeof raw !== "string") {
        return missingPayload("Missing tags payload.");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          ok: false,
          errorMessage: "Could not decode tags.",
          productId,
          field,
          requestToken,
        };
      }

      if (!Array.isArray(parsed)) {
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
  }
};

/** Action-only companion route — no dedicated UI. */
export default function ApplyListingFieldRouteStub() {
  return null;
}
