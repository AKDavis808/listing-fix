import type { ActionFunctionArgs } from "react-router";

import { DISABLE_UNINSTALL_WEBHOOK_REGISTRATION } from "../features/listingFix/afterAuthPipeline.server";
import { deleteShopSessions } from "../features/listingFix/shopSessions.server";
import { logListingFixEvent } from "../features/listingFix/telemetry";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (DISABLE_UNINSTALL_WEBHOOK_REGISTRATION) {
    logListingFixEvent({
      action: "session_restored",
      meta: {
        event: "uninstall_webhook_handler_disabled_for_testing",
        note: "Returning 200 without processing to isolate OAuth completion",
      },
    });
    return new Response(null, { status: 200 });
  }

  logListingFixEvent({
    action: "oauth_start",
    meta: { event: "uninstall_webhook_received" },
  });

  try {
    const { shop, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    await deleteShopSessions(shop, "app/uninstalled");

    logListingFixEvent({
      action: "oauth_complete",
      shop,
      meta: { event: "uninstall_webhook_processed" },
    });

    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      logListingFixEvent({
        action: "session_missing",
        meta: {
          event: "uninstall_webhook_auth_failed",
          status: 401,
          note: "Webhook auth failed; may race with OAuth reinstall",
        },
      });
    }

    throw error;
  }
};
