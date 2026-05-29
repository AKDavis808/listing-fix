/**
 * Shared read-only Admin GraphQL fetch for ListingFix catalog rows.
 */

export const LISTING_PRODUCTS_QUERY = `#graphql
  query ListingFixCatalogProducts($first: Int!) {
    products(first: $first, sortKey: TITLE) {
      nodes {
        id
        title
        status
        productType
        descriptionHtml
        tags
        seo {
          title
          description
        }
        variantsCount {
          count
        }
      }
    }
  }
`;

export type CatalogProductSnapshot = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  status: string;
  productType: string;
  tags: string[];
  variantsCount: number;
  seoTitle: string | null;
  seoDescription: string | null;
};

/** Payload for the browser — description is never shipped to the client. */
export type ClientCatalogProductRow = Omit<
  CatalogProductSnapshot,
  "descriptionHtml"
>;

export type FetchCatalogProductsResult =
  | { ok: true; products: CatalogProductSnapshot[] }
  | { ok: false; errorMessage: string };

function coerceCatalogProduct(
  node: Record<string, unknown>,
): CatalogProductSnapshot | null {
  const id = typeof node.id === "string" ? node.id : null;
  const title = typeof node.title === "string" ? node.title : null;
  if (!id || title === null) return null;

  const tags = Array.isArray(node.tags)
    ? (node.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  const vc = node.variantsCount as { count?: unknown } | undefined;
  const variantsCount =
    typeof vc?.count === "number"
      ? vc.count
      : typeof vc?.count === "string"
        ? Number.parseInt(vc.count, 10) || 0
        : 0;

  const statusRaw = node.status != null ? String(node.status) : "";

  const productType =
    typeof node.productType === "string"
      ? node.productType.trim()
      : "";

  const descriptionHtml =
    typeof node.descriptionHtml === "string"
      ? node.descriptionHtml
      : null;

  const seoNode = node.seo as
    | { title?: unknown; description?: unknown }
    | undefined;
  const seoTitle =
    seoNode && typeof seoNode.title === "string"
      ? seoNode.title.trim() || null
      : null;
  const seoDescription =
    seoNode && typeof seoNode.description === "string"
      ? seoNode.description.trim() || null
      : null;

  return {
    id,
    title,
    descriptionHtml,
    status: statusRaw,
    productType,
    tags,
    variantsCount,
    seoTitle,
    seoDescription,
  };
}

/** Strip description before sending catalog rows to the client. */
export function toClientCatalogRow(
  snapshot: CatalogProductSnapshot,
): ClientCatalogProductRow {
  return {
    id: snapshot.id,
    title: snapshot.title,
    status: snapshot.status,
    productType: snapshot.productType,
    tags: snapshot.tags,
    variantsCount: snapshot.variantsCount,
    seoTitle: snapshot.seoTitle,
    seoDescription: snapshot.seoDescription,
  };
}

type AdminGraphQl = {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
};

/** Load a single catalog product for AI or deep views (read-only). */
export async function fetchProductById(
  admin: AdminGraphQl,
  id: string,
): Promise<CatalogProductSnapshot | null> {
  const PRODUCT_QUERY = `#graphql
    query ListingFixProductById($id: ID!) {
      product(id: $id) {
        id
        title
        status
        productType
        descriptionHtml
        tags
        seo {
          title
          description
        }
        variantsCount {
          count
        }
      }
    }
  `;
  try {
    const response = await admin.graphql(PRODUCT_QUERY, { variables: { id } });
    const body = (await response.json()) as {
      errors?: { message?: string }[];
      data?: { product?: Record<string, unknown> | null };
    };
    if (body.errors?.length) {
      console.warn("[ListingFix] product by id GraphQL:", body.errors);
      return null;
    }
    const node = body.data?.product;
    if (!node) return null;
    return coerceCatalogProduct(node as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function fetchCatalogProducts(
  admin: AdminGraphQl,
  first = 25,
): Promise<FetchCatalogProductsResult> {
  try {
    const response = await admin.graphql(LISTING_PRODUCTS_QUERY, {
      variables: { first },
    });
    const body = (await response.json()) as {
      errors?: { message?: string }[];
      data?: {
        products?: { nodes?: Record<string, unknown>[] };
      };
    };

    const gqlErrors =
      body.errors?.map((e) => e.message).filter(Boolean) ?? [];
    if (gqlErrors.length) {
      return { ok: false, errorMessage: gqlErrors.join("; ") };
    }

    const nodes = body.data?.products?.nodes ?? [];
    const products: CatalogProductSnapshot[] = [];

    for (const node of nodes) {
      const row = coerceCatalogProduct(node);
      if (row) products.push(row);
    }

    return { ok: true, products };
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to load catalog products.";
    return { ok: false, errorMessage: message };
  }
}
