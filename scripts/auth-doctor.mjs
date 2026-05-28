#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import {
  EXPECTED_PRODUCTION_APP_URL,
  loadDotEnv,
  parseShopifyAppToml,
  readLastFlowSnapshot,
  writeAuthDebugReport,
} from "./lib/auth-debug-report.mjs";

loadDotEnv();

const shopArgIndex = process.argv.indexOf("--shop");
const shop =
  shopArgIndex >= 0 ? process.argv[shopArgIndex + 1]?.trim() : null;

const checks = [];

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail: detail ?? null });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[auth:doctor] ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

const toml = parseShopifyAppToml();
addCheck(
  "shopify.app.toml application_url present",
  Boolean(toml.applicationUrl),
  toml.applicationUrl,
);
addCheck(
  "production URL matches Railway",
  toml.applicationUrl === EXPECTED_PRODUCTION_APP_URL,
  `expected ${EXPECTED_PRODUCTION_APP_URL}`,
);
addCheck(
  "redirect URLs configured",
  toml.redirectUrls.length >= 1,
  toml.redirectUrls.join(", "),
);
addCheck(
  "redirect URLs include /auth/callback",
  toml.redirectUrls.some((url) => url.endsWith("/auth/callback")),
);
addCheck(
  "webhook URLs configured",
  toml.webhookUris.length >= 2,
  toml.webhookUris.join(", "),
);

const envChecks = [
  ["SHOPIFY_API_KEY", process.env.SHOPIFY_API_KEY],
  ["SHOPIFY_API_SECRET", process.env.SHOPIFY_API_SECRET],
  ["SCOPES", process.env.SCOPES],
  ["DATABASE_URL", process.env.DATABASE_URL],
  ["SHOPIFY_APP_URL", process.env.SHOPIFY_APP_URL],
];

for (const [name, value] of envChecks) {
  addCheck(`${name} present`, Boolean(value?.trim()));
}

addCheck(
  "SHOPIFY_APP_URL matches production",
  (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "") ===
    EXPECTED_PRODUCTION_APP_URL,
  process.env.SHOPIFY_APP_URL ?? null,
);

const prisma = new PrismaClient();
try {
  await prisma.$queryRaw`SELECT 1`;
  addCheck("Prisma can connect", true);
} catch (error) {
  addCheck(
    "Prisma can connect",
    false,
    error instanceof Error ? error.message : String(error),
  );
}

if (shop) {
  const normalizedShop = shop.includes(".") ? shop : `${shop}.myshopify.com`;
  const expectedOfflineId = `offline_${normalizedShop}`;

  try {
    const sessions = await prisma.session.findMany({
      where: { shop: normalizedShop },
      select: { id: true, isOnline: true, accessToken: true },
    });
    addCheck(
      `Prisma session rows for ${normalizedShop}`,
      sessions.length > 0,
      `${sessions.length} row(s)`,
    );
    const offline = sessions.find((row) => row.id === expectedOfflineId);
    addCheck(
      "offline session row exists",
      Boolean(offline?.accessToken),
      expectedOfflineId,
    );
  } catch (error) {
    addCheck(
      "offline session lookup",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
} else {
  addCheck(
    "offline session row exists",
    true,
    "skipped — pass --shop mystore.myshopify.com to check",
  );
}

await prisma.$disconnect();

const lastFlow = readLastFlowSnapshot();
const report = {
  generatedAt: new Date().toISOString(),
  lastFlowOutcome: lastFlow?.outcome ?? null,
  flowId: lastFlow?.flowId ?? null,
  lastFailingRoute: lastFlow?.lastRoute ?? null,
  likelyRootCause: lastFlow?.steps?.length
    ? inferRootCauseFromFlow(lastFlow)
    : "No local last-flow.json — run auth:e2e or reproduce OAuth locally.",
  nextAction:
    lastFlow?.outcome === "success"
      ? "Auth flow succeeded in last captured run."
      : "Fix failed doctor checks, then run npm run auth:e2e.",
  checks,
};

const outputPath = writeAuthDebugReport(report);
console.log(`\n[auth:doctor] Wrote ${outputPath}`);

function inferRootCauseFromFlow(flow) {
  const events = flow.steps?.map((step) => step.event) ?? [];
  if (events.includes("oauth_callback_validation_failure")) {
    return "OAuth callback validation failed.";
  }
  if (events.includes("prisma_storeSession_failure")) {
    return "Session save to Prisma failed after OAuth.";
  }
  if (
    events.includes("oauth_callback_entered") &&
    flow.steps.some((step) => step.meta?.cookieHeaderPresent === false)
  ) {
    return "Callback reached without OAuth state cookie.";
  }
  return `Flow stopped after '${events.at(-1) ?? "unknown"}'.`;
}
