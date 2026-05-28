import db from "../../db.server";

import { logListingFixEvent } from "./telemetry";

export async function deleteShopSessions(
  shop: string,
  source: string,
): Promise<number> {
  const result = await db.session.deleteMany({ where: { shop } });

  logListingFixEvent({
    action: "session_missing",
    shop,
    meta: {
      event: "uninstall_sessions_deleted",
      source,
      count: result.count,
    },
  });

  return result.count;
}
