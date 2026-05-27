import { useEffect } from "react";
import { useLocation } from "react-router";

import { logListingFixEvent } from "../../features/listingFix/telemetry";

export function ListingFixEmbeddedBootstrap({ shop }: { shop?: string | null }) {
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const embedded = params.get("embedded") === "1";

    if (embedded) {
      logListingFixEvent({
        action: "embedded_detected",
        shop,
        meta: {
          pathname: location.pathname,
          hasHost: Boolean(params.get("host")),
          hasShop: Boolean(params.get("shop")),
          source: "client",
        },
      });
    }
  }, [location.pathname, location.search, shop]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      logListingFixEvent({
        action: "runtime_error",
        shop,
        message: event.message,
        meta: { source: "embedded_bootstrap" },
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      logListingFixEvent({
        action: "runtime_error",
        shop,
        message: event.reason,
        meta: { source: "embedded_bootstrap_unhandledrejection" },
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [shop]);

  return null;
}
