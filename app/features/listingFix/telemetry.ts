export type ListingFixTelemetryAction =
  | "scan_start"
  | "scan_success"
  | "scan_failure"
  | "ai_start"
  | "ai_success"
  | "ai_failure"
  | "apply_start"
  | "apply_success"
  | "apply_failure"
  | "filter_interaction_error"
  | "catalog_load_failure"
  | "runtime_error";

export type ListingFixTelemetryEvent = {
  action: ListingFixTelemetryAction;
  shop?: string | null;
  productId?: string | null;
  durationMs?: number | null;
  message?: unknown;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

export type ListingFixTimer = {
  startedAt: number;
  label?: string;
};

const MAX_SANITIZED_MESSAGE_LENGTH = 480;

function extractErrorText(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage.trim();
  }
  try {
    return String(error).trim();
  } catch {
    return "";
  }
}

/** Strip stack traces and oversized blobs for logs and merchant-safe detail. */
export function sanitizeErrorMessage(error: unknown): string {
  let text = extractErrorText(error);
  if (!text) return "";

  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\n\s+at\s+[\s\S]*/m, "");
  text = text.replace(/\sat\s\S+\([^)]*\)/g, "");
  text = text.replace(/^\s*(Error|TypeError|ReferenceError|RangeError):\s*/i, "");
  text = text.replace(/\s+/g, " ").trim();

  if (text.length > MAX_SANITIZED_MESSAGE_LENGTH) {
    text = `${text.slice(0, MAX_SANITIZED_MESSAGE_LENGTH - 1)}…`;
  }

  return text;
}

export function startTimer(label?: string): ListingFixTimer {
  return { startedAt: Date.now(), label };
}

export function endTimer(timer: ListingFixTimer): number {
  return Math.max(0, Date.now() - timer.startedAt);
}

function isFailureAction(action: ListingFixTelemetryAction): boolean {
  return (
    action.endsWith("_failure") ||
    action === "filter_interaction_error" ||
    action === "runtime_error" ||
    action === "catalog_load_failure"
  );
}

/** Production-safe structured console logging. Never throws. */
export function logListingFixEvent(event: ListingFixTelemetryEvent): void {
  try {
    const sanitizedMessage =
      event.message == null ? undefined : sanitizeErrorMessage(event.message);

    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      action: event.action,
    };

    if (event.shop) payload.shop = event.shop;
    if (event.productId) payload.productId = event.productId;
    if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
      payload.durationMs = Math.round(event.durationMs);
    }
    if (sanitizedMessage) payload.message = sanitizedMessage;

    if (event.meta) {
      for (const [key, value] of Object.entries(event.meta)) {
        if (value == null) continue;
        if (typeof value === "string") {
          payload[key] =
            key.toLowerCase().includes("stack") ||
            key.toLowerCase().includes("message")
              ? sanitizeErrorMessage(value)
              : value.slice(0, MAX_SANITIZED_MESSAGE_LENGTH);
        } else {
          payload[key] = value;
        }
      }
    }

    const tag = `[ListingFix][${event.action}]`;
    if (isFailureAction(event.action)) {
      console.error(tag, payload);
    } else {
      console.info(tag, payload);
    }
  } catch (loggingError) {
    try {
      console.error("[ListingFix][telemetry_internal_error]", loggingError);
    } catch {
      // Swallow — telemetry must never break rendering.
    }
  }
}
