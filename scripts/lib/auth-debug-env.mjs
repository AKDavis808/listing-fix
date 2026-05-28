export function isAuthDebugEnabled() {
  const debugFlag = process.env.DEBUG?.trim().toLowerCase();
  if (debugFlag === "true" || debugFlag === "1") return true;

  const authDebugFlag = process.env.LISTINGFIX_AUTH_DEBUG?.trim().toLowerCase();
  if (authDebugFlag === "true" || authDebugFlag === "1") return true;

  return (process.env.NODE_ENV ?? "development") === "development";
}

export function requireAuthDebugEnabled(scriptName) {
  if (isAuthDebugEnabled()) return;

  console.error(
    `[${scriptName}] Requires NODE_ENV=development, DEBUG=true, or LISTINGFIX_AUTH_DEBUG=1.`,
  );
  process.exit(1);
}
