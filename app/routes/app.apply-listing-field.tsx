import type { ActionFunctionArgs } from "react-router";

import {
  endTimer,
  logListingFixEvent,
  startTimer,
} from "../features/listingFix/telemetry";
import { incrementApplyUsage } from "../features/listingFix/usage.server";
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
    fieldRaw === "title" ||
    fieldRaw === "description" ||
    fieldRaw === "tags" ||
    fieldRaw === "seo"
      ? fieldRaw
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

  function finalizeOutcome(
    outcome: ProductFieldUpdateResult,
  ): ApplyListingFieldActionData {
    if (outcome.ok) {
      void incrementApplyUsage(shop).catch(() => {
        // Usage tracking must not block successful Shopify updates.
      });
      logListingFixEvent({
        action: "apply_success",
        shop,
        productId,
        durationMs: endTimer(timer),
        meta: { field },
      });
      return { ok: true, productId, field, requestToken };
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
