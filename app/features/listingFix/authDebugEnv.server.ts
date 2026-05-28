/** DEBUG-only auth diagnostics — never enable in production unless explicitly opted in. */
export function isAuthDebugEnabled(): boolean {
  const debugFlag = process.env.DEBUG?.trim().toLowerCase();
  if (debugFlag === "true" || debugFlag === "1") return true;

  const authDebugFlag = process.env.LISTINGFIX_AUTH_DEBUG?.trim().toLowerCase();
  if (authDebugFlag === "true" || authDebugFlag === "1") return true;

  return (process.env.NODE_ENV ?? "development") === "development";
}
