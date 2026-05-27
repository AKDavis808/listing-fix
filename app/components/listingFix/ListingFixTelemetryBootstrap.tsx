import { useEffect } from "react";

import { installListingFixGlobalErrorHandlers } from "../../features/listingFix/globalErrorHandlers";

export function ListingFixTelemetryBootstrap({
  shop,
}: {
  shop?: string | null;
}) {
  useEffect(() => {
    return installListingFixGlobalErrorHandlers(shop);
  }, [shop]);

  return null;
}
