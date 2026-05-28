import { isAuthDebugEnabled } from "./authDebugEnv.server";

const diagnosticTimestamps = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 60_000;

export function shouldLogAuthDiagnostic(
  key: string,
  cooldownMs = DEFAULT_COOLDOWN_MS,
): boolean {
  if (!isAuthDebugEnabled()) return false;

  const now = Date.now();
  const last = diagnosticTimestamps.get(key) ?? 0;
  if (now - last < cooldownMs) {
    return false;
  }
  diagnosticTimestamps.set(key, now);
  return true;
}

export function logAuthDiagnosticOnce(
  key: string,
  logFn: () => void,
  cooldownMs = DEFAULT_COOLDOWN_MS,
): void {
  if (!shouldLogAuthDiagnostic(key, cooldownMs)) return;
  logFn();
}
