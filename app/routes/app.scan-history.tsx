import type { ActionFunctionArgs } from "react-router";

import { restoreCatalogScanSession } from "../features/listingFix/scanHistory.server";
import type { ScanResultsPayloadV1 } from "../features/listingFix/scanHistoryTypes";
import type { CatalogScanSessionSummary } from "../features/listingFix/scanHistoryTypes";
import { authenticate } from "../shopify.server";
import {
  fetchCatalogProducts,
  toClientCatalogRow,
} from "../services/listingProducts.server";

export type RestoreScanActionData =
  | {
      ok: true;
      payload: ScanResultsPayloadV1;
      session: CatalogScanSessionSummary;
    }
  | { ok: false; error: string };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<RestoreScanActionData> => {
  const { admin, session } = await authenticate.admin(request);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: "Invalid restore request." };
  }

  if (formData.get("intent") !== "restore-scan") {
    return { ok: false, error: "Unsupported scan history action." };
  }

  const sessionIdRaw = formData.get("sessionId");
  const sessionId =
    typeof sessionIdRaw === "string" ? sessionIdRaw.trim() : "";
  if (!sessionId) {
    return { ok: false, error: "Choose a scan to restore." };
  }

  const catalog = await fetchCatalogProducts(admin, 25);
  if (!catalog.ok) {
    return { ok: false, error: "Couldn't load the current catalog." };
  }

  const productIds = catalog.products
    .map((product) => toClientCatalogRow(product).id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return restoreCatalogScanSession({
    shopDomain: session.shop,
    sessionId,
    productIds,
  });
};

/** POST-only scan history restore route. */
export default function ScanHistoryRouteStub() {
  return null;
}
