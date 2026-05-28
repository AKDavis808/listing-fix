import type { Session } from "@shopify/shopify-api";

import {
  logAfterAuthPhase,
  logAfterAuthWebhookFailure,
  logAfterAuthWebhookSuccess,
  logAfterAuthFinished,
} from "./oauthSessionDiagnostics.server";
import { verifyPrismaSessionPersisted } from "./sessionPersistence.server";
import { logListingFixEvent, sanitizeErrorMessage } from "./telemetry";

/** Temporarily skip afterAuth webhook registration to isolate OAuth completion. */
export const DISABLE_AFTER_AUTH_WEBHOOK_REGISTRATION = true;

/** Temporarily skip uninstall webhook topic during registration when enabled. */
export const DISABLE_UNINSTALL_WEBHOOK_REGISTRATION = true;

type RegisterWebhooksFn = (options: {
  session: Session;
}) => Promise<unknown>;

type AfterAuthPipelineOptions = {
  session: Session;
  admin?: unknown;
  registerWebhooks?: RegisterWebhooksFn;
  storeSessionAlreadyCompleted?: boolean;
};

function summarizeWebhookRegistrationResponse(response: unknown): Record<
  string,
  string | number | boolean | null | undefined
> {
  if (!response || typeof response !== "object") {
    return { responseType: typeof response };
  }

  const summary: Record<string, string | number | boolean | null | undefined> =
    {};
  for (const [topic, results] of Object.entries(response)) {
    if (!Array.isArray(results)) continue;
    const successCount = results.filter(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { success?: boolean }).success === true,
    ).length;
    const failure = results.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { success?: boolean }).success === false,
    ) as
      | {
          success?: boolean;
          operation?: string;
          result?: unknown;
        }
      | undefined;

    summary[`topic_${topic}_successCount`] = successCount;
    summary[`topic_${topic}_failureCount`] = results.length - successCount;
    if (failure?.result) {
      summary[`topic_${topic}_failureResult`] = sanitizeErrorMessage(
        JSON.stringify(failure.result),
      );
    }
    if (failure?.operation) {
      summary[`topic_${topic}_failureOperation`] = failure.operation;
    }
  }

  return summary;
}

function extractGraphQLErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;

  const body = (error as { body?: { errors?: { graphQLErrors?: unknown[] } } })
    .body;
  const graphQLErrors = body?.errors?.graphQLErrors;
  if (!Array.isArray(graphQLErrors) || graphQLErrors.length === 0) {
    return undefined;
  }

  try {
    return sanitizeErrorMessage(JSON.stringify(graphQLErrors));
  } catch {
    return undefined;
  }
}

export async function runAfterAuthPipeline(
  options: AfterAuthPipelineOptions,
): Promise<void> {
  const { session, admin, registerWebhooks, storeSessionAlreadyCompleted } =
    options;

  logAfterAuthPhase("afterAuth_start", session, {
    storeSessionAlreadyCompleted: Boolean(storeSessionAlreadyCompleted),
  });

  if (!storeSessionAlreadyCompleted) {
    logAfterAuthPhase("afterAuth_before_storeSession", session);
  } else {
    logAfterAuthPhase("afterAuth_before_storeSession", session, {
      skipped: true,
      note: "storeSession completed in OAuth callback handler",
    });
  }

  const prismaVerified = await verifyPrismaSessionPersisted(session);

  logAfterAuthPhase("afterAuth_after_storeSession", session, {
    prismaVerified,
    offlineSessionPersisted: prismaVerified,
  });

  logAfterAuthPhase("afterAuth_before_webhooks", session, {
    adminClientAvailable: Boolean(admin),
    webhookRegistrationDisabled: DISABLE_AFTER_AUTH_WEBHOOK_REGISTRATION,
    uninstallWebhookRegistrationDisabled: DISABLE_UNINSTALL_WEBHOOK_REGISTRATION,
  });

  if (DISABLE_AFTER_AUTH_WEBHOOK_REGISTRATION) {
    logAfterAuthWebhookSuccess(session, {
      skipped: true,
      reason: "after_auth_webhook_registration_disabled_for_testing",
    });
  } else if (!registerWebhooks) {
    logAfterAuthWebhookSuccess(session, {
      skipped: true,
      reason: "registerWebhooks_unavailable",
    });
  } else if (!admin) {
    logAfterAuthWebhookSuccess(session, {
      skipped: true,
      reason: "admin_client_unavailable",
    });
  } else {
    try {
      const response = await registerWebhooks({ session });
      logAfterAuthWebhookSuccess(session, {
        webhookRegistrationSucceeded: true,
        ...summarizeWebhookRegistrationResponse(response),
      });
    } catch (error) {
      logAfterAuthWebhookFailure(session, error, {
        adminClientAvailable: true,
        graphQLError: extractGraphQLErrorMessage(error),
      });
      logListingFixEvent({
        action: "oauth_complete",
        shop: session.shop,
        meta: {
          event: "afterAuth_after_webhooks",
          webhookRegistrationSucceeded: false,
          continuedDespiteFailure: true,
        },
      });
    }
  }

  logAfterAuthFinished(session, prismaVerified, storeSessionAlreadyCompleted);
}
