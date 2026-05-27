import type { Prisma, ShopUsageDaily } from "@prisma/client";

import prisma from "../../db.server";
import { logListingFixEvent } from "./telemetry";
import {
  AI_LIMIT_MESSAGE,
  DAILY_AI_LIMIT,
  DAILY_SCAN_LIMIT,
  SCAN_LIMIT_MESSAGE,
  type ListingFixDailyUsageSnapshot,
} from "./usageLimits";

type PrismaTx = Prisma.TransactionClient;

export function getUtcDateBucket(forDate = new Date()): Date {
  return new Date(
    Date.UTC(
      forDate.getUTCFullYear(),
      forDate.getUTCMonth(),
      forDate.getUTCDate(),
    ),
  );
}

function toUsageSnapshot(row: ShopUsageDaily): ListingFixDailyUsageSnapshot {
  const scansUsed = Math.max(0, row.scanCount);
  const aiUsed = Math.max(0, row.aiGenerationCount);
  const applyUsed = Math.max(0, row.applyCount);

  return {
    scansRemaining: Math.max(0, DAILY_SCAN_LIMIT - scansUsed),
    aiRemaining: Math.max(0, DAILY_AI_LIMIT - aiUsed),
    scansUsed,
    aiUsed,
    applyUsed,
    scanLimit: DAILY_SCAN_LIMIT,
    aiLimit: DAILY_AI_LIMIT,
    usageDate: row.usageDate.toISOString().slice(0, 10),
  };
}

function logUsageRemaining(shop: string, snapshot: ListingFixDailyUsageSnapshot) {
  logListingFixEvent({
    action: "usage_remaining",
    shop,
    meta: {
      scansRemaining: snapshot.scansRemaining,
      aiRemaining: snapshot.aiRemaining,
      scansUsed: snapshot.scansUsed,
      aiUsed: snapshot.aiUsed,
      usageDate: snapshot.usageDate,
    },
  });
}

export async function getOrCreateDailyUsage(
  shop: string,
  usageDate = getUtcDateBucket(),
  tx: PrismaTx | typeof prisma = prisma,
): Promise<ShopUsageDaily> {
  const normalizedShop = shop.trim();
  if (!normalizedShop.length) {
    throw new Error("Shop domain is required for usage tracking.");
  }

  return tx.shopUsageDaily.upsert({
    where: {
      shop_usageDate: {
        shop: normalizedShop,
        usageDate,
      },
    },
    create: {
      shop: normalizedShop,
      usageDate,
    },
    update: {},
  });
}

export async function getRemainingUsage(
  shop: string,
): Promise<ListingFixDailyUsageSnapshot> {
  const row = await getOrCreateDailyUsage(shop);
  return toUsageSnapshot(row);
}

export async function hasRemainingScanUsage(shop: string): Promise<boolean> {
  const row = await getOrCreateDailyUsage(shop);
  return row.scanCount < DAILY_SCAN_LIMIT;
}

export async function hasRemainingAiUsage(shop: string): Promise<boolean> {
  const row = await getOrCreateDailyUsage(shop);
  return row.aiGenerationCount < DAILY_AI_LIMIT;
}

export type UsageConsumeResult =
  | { ok: true; usage: ListingFixDailyUsageSnapshot }
  | {
      ok: false;
      usage: ListingFixDailyUsageSnapshot;
      message: string;
      limitKind: "scan" | "ai";
    };

export async function incrementScanUsage(shop: string): Promise<UsageConsumeResult> {
  const usageDate = getUtcDateBucket();

  const outcome = await prisma.$transaction(async (tx) => {
    const row = await getOrCreateDailyUsage(shop, usageDate, tx);
    if (row.scanCount >= DAILY_SCAN_LIMIT) {
      return { limited: true as const, row };
    }

    const updated = await tx.shopUsageDaily.update({
      where: { id: row.id },
      data: { scanCount: { increment: 1 } },
    });

    return { limited: false as const, row: updated };
  });

  const usage = toUsageSnapshot(outcome.row);

  if (outcome.limited) {
    logListingFixEvent({
      action: "usage_limit_hit",
      shop,
      message: SCAN_LIMIT_MESSAGE,
      meta: {
        kind: "scan",
        scansRemaining: usage.scansRemaining,
        aiRemaining: usage.aiRemaining,
        usageDate: usage.usageDate,
      },
    });
    return {
      ok: false,
      usage,
      message: SCAN_LIMIT_MESSAGE,
      limitKind: "scan",
    };
  }

  logListingFixEvent({
    action: "usage_increment",
    shop,
    meta: {
      kind: "scan",
      scansUsed: usage.scansUsed,
      scansRemaining: usage.scansRemaining,
      usageDate: usage.usageDate,
    },
  });
  logUsageRemaining(shop, usage);

  return { ok: true, usage };
}

export async function incrementAiUsage(shop: string): Promise<UsageConsumeResult> {
  const usageDate = getUtcDateBucket();

  const outcome = await prisma.$transaction(async (tx) => {
    const row = await getOrCreateDailyUsage(shop, usageDate, tx);
    if (row.aiGenerationCount >= DAILY_AI_LIMIT) {
      return { limited: true as const, row };
    }

    const updated = await tx.shopUsageDaily.update({
      where: { id: row.id },
      data: { aiGenerationCount: { increment: 1 } },
    });

    return { limited: false as const, row: updated };
  });

  const usage = toUsageSnapshot(outcome.row);

  if (outcome.limited) {
    logListingFixEvent({
      action: "usage_limit_hit",
      shop,
      message: AI_LIMIT_MESSAGE,
      meta: {
        kind: "ai",
        scansRemaining: usage.scansRemaining,
        aiRemaining: usage.aiRemaining,
        usageDate: usage.usageDate,
      },
    });
    return {
      ok: false,
      usage,
      message: AI_LIMIT_MESSAGE,
      limitKind: "ai",
    };
  }

  logListingFixEvent({
    action: "usage_increment",
    shop,
    meta: {
      kind: "ai",
      aiUsed: usage.aiUsed,
      aiRemaining: usage.aiRemaining,
      usageDate: usage.usageDate,
    },
  });
  logUsageRemaining(shop, usage);

  return { ok: true, usage };
}

export async function incrementApplyUsage(
  shop: string,
): Promise<ListingFixDailyUsageSnapshot> {
  const usageDate = getUtcDateBucket();

  const row = await prisma.$transaction(async (tx) => {
    const existing = await getOrCreateDailyUsage(shop, usageDate, tx);
    return tx.shopUsageDaily.update({
      where: { id: existing.id },
      data: { applyCount: { increment: 1 } },
    });
  });

  const usage = toUsageSnapshot(row);

  logListingFixEvent({
    action: "usage_increment",
    shop,
    meta: {
      kind: "apply",
      applyUsed: usage.applyUsed,
      usageDate: usage.usageDate,
    },
  });

  return usage;
}
