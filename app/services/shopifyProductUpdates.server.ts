/**
 * Scoped Shopify Admin GraphQL writes for listing fields.
 * Keeps mutations out of audits, AI, and UI formatting.
 */

type AdminGraphQl = {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
};

export type ProductFieldUpdateFailure = {
  ok: false;
  errorMessage: string;
  userErrors?: ReadonlyArray<{ field?: readonly string[]; message?: string }>;
};

export type ProductFieldUpdateOk = {
  ok: true;
};

export type ProductFieldUpdateResult =
  | ProductFieldUpdateOk
  | ProductFieldUpdateFailure;

type GraphqlEnvelope<T> = {
  errors?: { message?: string }[];
  data?: T;
};

type UserErrorsPayload = ReadonlyArray<{
  field?: unknown;
  message?: unknown;
}>;

function coerceUserErrors(
  raw: UserErrorsPayload | undefined,
): NonNullable<ProductFieldUpdateFailure["userErrors"]> {
  const out: { field?: readonly string[]; message?: string }[] = [];
  for (const e of raw ?? []) {
    const fieldRaw = Array.isArray(e.field)
      ? e.field.filter((f): f is string => typeof f === "string")
      : [];
    const message = typeof e.message === "string" ? e.message : "";
    out.push({
      ...(fieldRaw.length ? { field: fieldRaw } : {}),
      ...(message ? { message } : {}),
    });
  }
  return out.length ? out : [];
}

async function runProductUpdate(
  admin: AdminGraphQl,
  productId: string,
  patch: Record<string, unknown>,
): Promise<ProductFieldUpdateResult> {
  const body: GraphqlEnvelope<{
    productUpdate?: {
      userErrors?: UserErrorsPayload;
    };
  }> = {};

  try {
    const response = await admin.graphql(
      `#graphql
        mutation ListingFixProductUpdate($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          product: {
            id: productId,
            ...patch,
          },
        },
      },
    );

    Object.assign(body, await response.json());
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : "Network error contacting Shopify.";
    return { ok: false, errorMessage: msg };
  }

  if (body.errors?.length) {
    return {
      ok: false,
      errorMessage: body.errors
        .map((e) => e.message)
        .filter(Boolean)
        .join("; "),
    };
  }

  const errs = coerceUserErrors(body.data?.productUpdate?.userErrors);
  if (errs.length) {
    return {
      ok: false,
      errorMessage: errs.map((e) => e.message ?? "").filter(Boolean).join("; "),
      userErrors: errs,
    };
  }

  return { ok: true };
}

/**
 * Validates non-empty Shopify product GID.
 */
export function assertProductGid(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || !trimmed.includes("gid://shopify/Product/")) {
    return null;
  }
  return trimmed;
}

/**
 * Normalize AI/plain text output into storefront-safe descriptionHtml for productUpdate.
 * - Drops script/style
 * - If no HTML-ish tags detected, escapes plain text and preserves logical paragraphs
 */
export function normalizeDescriptionHtmlForShopify(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.length) return "";

  const stripped = trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const htmlLikeFragment = /<[a-z][\s\S]*>/i.test(stripped);

  function escapePlainText(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  if (htmlLikeFragment) {
    return stripped;
  }

  const paragraphs = stripped
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "";
  }

  return paragraphs
    .map((paragraph) => {
      const inner = escapePlainText(paragraph).replace(/\n/g, "<br />\n");
      return `<p>${inner}</p>`;
    })
    .join("\n");
}

/** Updates only product title. */
export async function updateProductTitle(
  admin: AdminGraphQl,
  productId: string,
  title: string,
): Promise<ProductFieldUpdateResult> {
  const trimmed = title.trim();
  if (!trimmed.length) {
    return { ok: false, errorMessage: "Title cannot be empty." };
  }
  return runProductUpdate(admin, productId, { title: trimmed });
}

/** Updates only descriptionHtml — does not touch title, SEO, tags, etc. */
export async function updateProductDescription(
  admin: AdminGraphQl,
  productId: string,
  descriptionHtmlInput: string,
): Promise<ProductFieldUpdateResult> {
  const normalized = normalizeDescriptionHtmlForShopify(descriptionHtmlInput);
  if (!normalized.length) {
    return { ok: false, errorMessage: "Description cannot be empty." };
  }
  return runProductUpdate(admin, productId, { descriptionHtml: normalized });
}

/** Replaces storefront tags wholesale with supplied list — merchant must deliberately apply. */
export async function updateProductTags(
  admin: AdminGraphQl,
  productId: string,
  tagsIn: readonly string[],
): Promise<ProductFieldUpdateResult> {
  const tags = [...new Set(tagsIn.map((t) => t.trim()).filter(Boolean))];
  if (tags.length === 0) {
    return { ok: false, errorMessage: "At least one tag is required." };
  }
  if (tags.length > 250) {
    return {
      ok: false,
      errorMessage: "Shopify permits at most 250 tags per product.",
    };
  }
  return runProductUpdate(admin, productId, { tags });
}

type SeoPrefetch =
  | {
      ok: true;
      productTitle: string;
      seoTitle: string | null;
      seoDescription: string | null;
    }
  | ProductFieldUpdateFailure;

async function fetchProductSeoContext(
  admin: AdminGraphQl,
  productId: string,
): Promise<SeoPrefetch> {
  try {
    const response = await admin.graphql(
      `#graphql
        query ListingFixFetchSeoTitle($id: ID!) {
          product(id: $id) {
            id
            title
            seo {
              title
              description
            }
          }
        }
      `,
      {
        variables: { id: productId },
      },
    );

    const body = (await response.json()) as GraphqlEnvelope<{
      product?: {
        title?: string;
        seo?: {
          title?: string | null;
          description?: string | null;
        } | null;
      } | null;
    }>;

    if (body.errors?.length) {
      return {
        ok: false,
        errorMessage:
          body.errors
            .map((e) => e.message ?? "")
            .filter(Boolean)
            .join("; ") || "Unexpected GraphQL error.",
      };
    }

    const product = body.data?.product;
    const productTitle =
      typeof product?.title === "string" ? product.title.trim() : "";
    const seoTitle =
      product?.seo && typeof product.seo.title === "string"
        ? product.seo.title.trim()
        : null;

    const seoDesc =
      product?.seo && typeof product.seo.description === "string"
        ? product.seo.description.trim()
        : null;

    if (!productTitle) {
      return {
        ok: false,
        errorMessage:
          "Couldn't read SEO context for this product. Try reloading the catalog.",
      };
    }

    return {
      ok: true,
      productTitle,
      seoTitle: seoTitle && seoTitle.length ? seoTitle : null,
      seoDescription: seoDesc && seoDesc.length ? seoDesc : null,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      errorMessage:
        e instanceof Error
          ? e.message
          : "Failed loading current SEO heading before update.",
    };
  }
}

/**
 * Writes only Shopify search-engine listing meta description (`product.seo.description`).
 * Preserves explicit SEO titles when present — otherwise derives from product title — so Shopify does not silently blank them.
 */
export async function updateProductSEO(
  admin: AdminGraphQl,
  productId: string,
  seoDescription: string,
): Promise<ProductFieldUpdateResult> {
  const trimmed = seoDescription.trim();
  if (!trimmed.length) {
    return {
      ok: false,
      errorMessage: "SEO meta description cannot be empty.",
    };
  }

  if (trimmed.length > 320) {
    return {
      ok: false,
      errorMessage:
        "SEO meta description exceeds 320 characters and was not submitted.",
    };
  }

  const seoContext = await fetchProductSeoContext(admin, productId);
  if (!seoContext.ok) {
    return seoContext;
  }

  const { productTitle, seoTitle } = seoContext;

  const seoTitleToSend = seoTitle ?? productTitle;

  return runProductUpdate(admin, productId, {
    seo: {
      title: seoTitleToSend,
      description: trimmed,
    },
  });
}
