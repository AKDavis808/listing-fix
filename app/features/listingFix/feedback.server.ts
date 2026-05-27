import prisma from "../../db.server";
import { logListingFixEvent } from "./telemetry";
import {
  FEEDBACK_COOLDOWN_MESSAGE,
  FEEDBACK_COOLDOWN_MS,
  FEEDBACK_EMPTY_MESSAGE,
  LISTING_FIX_APP_VERSION,
  MAX_FEEDBACK_EMAIL_LENGTH,
  MAX_FEEDBACK_MESSAGE_LENGTH,
  isBetaFeedbackType,
  type BetaFeedbackType,
} from "./feedbackTypes";

export type SubmitBetaFeedbackInput = {
  shopDomain: string;
  feedbackType: string;
  message: string;
  optionalEmail?: string;
  currentRoute?: string;
  browserInfo?: string;
};

function trimField(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().slice(0, MAX_FEEDBACK_EMAIL_LENGTH);
  if (!trimmed.length) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function submitBetaFeedback(
  input: SubmitBetaFeedbackInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const shopDomain = trimField(input.shopDomain, 255);
  if (!shopDomain.length) {
    return { ok: false, error: "Shop context is missing." };
  }

  const feedbackTypeRaw = trimField(input.feedbackType, 64);
  if (!isBetaFeedbackType(feedbackTypeRaw)) {
    return { ok: false, error: "Choose a feedback type." };
  }
  const feedbackType: BetaFeedbackType = feedbackTypeRaw;

  const message = trimField(input.message, MAX_FEEDBACK_MESSAGE_LENGTH);
  if (message.length < 8) {
    return { ok: false, error: FEEDBACK_EMPTY_MESSAGE };
  }

  const optionalEmailRaw = trimField(input.optionalEmail, MAX_FEEDBACK_EMAIL_LENGTH);
  let optionalEmail: string | null = null;
  if (optionalEmailRaw.length) {
    const normalized = normalizeEmail(optionalEmailRaw);
    if (!normalized) {
      return {
        ok: false,
        error: "Enter a valid email address or leave this blank.",
      };
    }
    optionalEmail = normalized;
  }

  const currentRoute = trimField(input.currentRoute, 512) || null;
  const browserInfo = trimField(input.browserInfo, 512) || null;

  try {
    const recent = await prisma.betaFeedback.findFirst({
      where: {
        shopDomain,
        createdAt: {
          gte: new Date(Date.now() - FEEDBACK_COOLDOWN_MS),
        },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (recent) {
      logListingFixEvent({
        action: "feedback_failed",
        shop: shopDomain,
        message: FEEDBACK_COOLDOWN_MESSAGE,
        meta: { feedbackType, reason: "cooldown" },
      });
      return { ok: false, error: FEEDBACK_COOLDOWN_MESSAGE };
    }

    await prisma.betaFeedback.create({
      data: {
        shopDomain,
        feedbackType,
        message,
        optionalEmail,
        appVersion: LISTING_FIX_APP_VERSION,
        currentRoute,
        browserInfo,
      },
    });

    logListingFixEvent({
      action: "feedback_submitted",
      shop: shopDomain,
      meta: {
        feedbackType,
        currentRoute,
        messageLength: message.length,
      },
    });

    return { ok: true };
  } catch (error) {
    logListingFixEvent({
      action: "feedback_failed",
      shop: shopDomain,
      message: error,
      meta: { feedbackType },
    });
    return {
      ok: false,
      error: "We couldn't save your feedback right now. Please try again shortly.",
    };
  }
}
