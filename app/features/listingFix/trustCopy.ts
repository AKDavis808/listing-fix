export const LISTING_FIX_BETA_LABEL = "ListingFix Beta";

export const TRUST_PANEL_TITLE = "How ListingFix Works";

export const TRUST_PANEL_POINTS = [
  "ListingFix scans product listings for optimization opportunities.",
  "Nothing is automatically published or changed in your store.",
  "AI suggestions should always be reviewed before applying.",
  "Apply actions only update the selected Shopify field.",
  "Beta testing currently includes limited daily AI usage.",
] as const;

export const TRUST_SECTIONS = [
  {
    title: "What gets scanned",
    body: "Your first 25 catalog products are reviewed for titles, descriptions, tags, SEO signals, and listing completeness.",
  },
  {
    title: "What ListingFix can improve",
    body: "You receive clear recommendations for catalog quality, search visibility, and product presentation.",
  },
  {
    title: "How AI suggestions work",
    body: "AI drafts optional copy based on your audit. Review, edit, or ignore anything before taking action.",
  },
  {
    title: "Your catalog stays under your control",
    body: "ListingFix never bulk-updates products. You choose exactly what to apply, one field at a time.",
  },
] as const;

export const FIRST_SCAN_HEADING = "Start with your first catalog scan";

export const FIRST_SCAN_BODY =
  "Run your first catalog scan to identify SEO, title, description, and optimization opportunities.";

export const REASSURANCE = {
  scan: "Nothing is updated automatically. Scan results are for review only.",
  ai: "AI suggestions are editable. Review them before applying anything to Shopify.",
  apply: "Changes are reviewed before publishing. Only the selected field is updated.",
} as const;

export const BETA_FOOTER_LINES = [
  "Daily usage limits apply during beta testing.",
  "Feedback is welcome as we improve stability and polish.",
] as const;

export const LEGAL_LINKS = {
  privacy: "https://www.akdavisdesigns.com/listingfix/privacy",
  terms: "https://www.akdavisdesigns.com/listingfix/terms",
  support: "https://www.akdavisdesigns.com/listingfix/support",
} as const;

export const AI_DISCLOSURE =
  "AI suggestions are generated from selected product listing details and should be reviewed before applying.";

export const BETA_DISCLOSURE =
  "ListingFix is currently in beta. Features, limits, and recommendations may change as we improve the app.";
