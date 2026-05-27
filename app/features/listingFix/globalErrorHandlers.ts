import { logListingFixEvent } from "./telemetry";

/** Install browser-level runtime guards. Returns a cleanup function. */
export function installListingFixGlobalErrorHandlers(
  shop?: string | null,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const onWindowError = (event: ErrorEvent) => {
    logListingFixEvent({
      action: "runtime_error",
      shop,
      message: event.message,
      meta: {
        source: event.filename ?? null,
        line: event.lineno ?? null,
        column: event.colno ?? null,
      },
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    logListingFixEvent({
      action: "runtime_error",
      shop,
      message: event.reason,
      meta: { kind: "unhandledrejection" },
    });
  };

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
