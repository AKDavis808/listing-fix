export const DAILY_SCAN_LIMIT = 25;
export const DAILY_AI_LIMIT = 10;

export type ListingFixDailyUsageSnapshot = {
  scansRemaining: number;
  aiRemaining: number;
  scansUsed: number;
  aiUsed: number;
  applyUsed: number;
  scanLimit: number;
  aiLimit: number;
  usageDate: string;
};

export const SCAN_LIMIT_MESSAGE =
  "Daily scan limit reached. You can run more scans tomorrow during the ListingFix beta.";

export const AI_LIMIT_MESSAGE =
  "Daily AI generation limit reached. You can generate more suggestions tomorrow during the ListingFix beta.";

export const BETA_USAGE_MESSAGE =
  "ListingFix beta includes limited daily AI usage during testing.";
