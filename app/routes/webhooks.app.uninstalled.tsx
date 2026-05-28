import type { ActionFunctionArgs } from "react-router";

import { deleteShopSessions } from "../features/listingFix/shopSessions.server";
import { logListingFixEvent } from "../features/listingFix/telemetry";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  logListingFixEvent({
    action: "oauth_complete",
    meta: { event: "uninstall_webhook_received" },
  });

  try {
    const { shop, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    await deleteShopSessions(shop, "app/uninstalled");

    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      logListingFixEvent({
        action: "session_missing",
        meta: {
          event: "uninstall_webhook_auth_failed",
          status: 401,
        },
      });
    }

    throw error;
  }
};
