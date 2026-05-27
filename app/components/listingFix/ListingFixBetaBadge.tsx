import { Badge } from "@shopify/polaris";

import { LISTING_FIX_BETA_LABEL } from "../../features/listingFix/trustCopy";

export function ListingFixBetaBadge() {
  return (
    <Badge tone="success" progress="incomplete">
      {LISTING_FIX_BETA_LABEL}
    </Badge>
  );
}
