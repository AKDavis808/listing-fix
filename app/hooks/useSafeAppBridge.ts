import { useEffect, useState } from "react";
import type { ShopifyGlobal } from "@shopify/app-bridge-react";

import { logListingFixEvent } from "../features/listingFix/telemetry";

const POLL_MS = 50;
const MAX_WAIT_MS = 10_000;

/**
 * App Bridge loads asynchronously via script tag. useAppBridge() throws if
 * window.shopify is missing, which breaks hydration after SSR. This hook waits
 * safely and never throws during render.
 */
export function useSafeAppBridge(shop?: string | null): ShopifyGlobal | null {
  const [shopify, setShopify] = useState<ShopifyGlobal | null>(() => {
    if (typeof window === "undefined") return null;
    return window.shopify ?? null;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.shopify) {
      setShopify(window.shopify);
      logListingFixEvent({
        action: "app_bridge_ready",
        shop,
        meta: { source: "immediate" },
      });
      return;
    }

    logListingFixEvent({
      action: "app_bridge_missing",
      shop,
      meta: { source: "initial_client_render" },
    });

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      if (window.shopify) {
        window.clearInterval(intervalId);
        setShopify(window.shopify);
        logListingFixEvent({
          action: "app_bridge_ready",
          shop,
          meta: {
            source: "poll",
            waitMs: Date.now() - startedAt,
          },
        });
        return;
      }

      if (Date.now() - startedAt >= MAX_WAIT_MS) {
        window.clearInterval(intervalId);
        logListingFixEvent({
          action: "app_bridge_missing",
          shop,
          meta: {
            source: "poll_timeout",
            waitMs: MAX_WAIT_MS,
          },
        });
      }
    }, POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [shop]);

  return shopify;
}

export function showAppBridgeToast(
  shopify: ShopifyGlobal | null,
  message: string,
  options?: { isError?: boolean },
): void {
  if (!shopify?.toast) return;
  shopify.toast.show(message, options);
}
