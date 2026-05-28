#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

import {
  EXPECTED_PRODUCTION_APP_URL,
  loadDotEnv,
  writeAuthDebugReport,
} from "./lib/auth-debug-report.mjs";

loadDotEnv();

const appUrl = (process.env.SHOPIFY_APP_URL ?? EXPECTED_PRODUCTION_APP_URL).replace(
  /\/$/,
  "",
);
const shop = process.env.AUTH_E2E_SHOP?.trim();
const adminUrl =
  process.env.AUTH_E2E_ADMIN_URL?.trim() ??
  (shop
    ? `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/listingfix`
    : null);

if (!adminUrl) {
  console.error(
    "[auth:e2e] Set AUTH_E2E_SHOP or AUTH_E2E_ADMIN_URL to the Shopify Admin embedded app URL.",
  );
  process.exit(1);
}

const screenshotDir = join(process.cwd(), ".auth-debug", "screenshots");
const chromeProfileDir = join(process.cwd(), ".auth-debug", "chrome-profile");
mkdirSync(screenshotDir, { recursive: true });
mkdirSync(chromeProfileDir, { recursive: true });

/** @type {Array<{url: string, status?: number, setCookieCount?: number, cookieHeader?: string | null}>} */
const navigations = [];
let failureScreenshot = null;
let finalPageText = "";
let browserMode = "chrome-persistent";

function countSetCookie(headers) {
  if (!headers) return 0;
  const values = headers["set-cookie"];
  if (!values) return 0;
  return Array.isArray(values) ? values.length : 1;
}

function buildBrowserLaunchOptions() {
  const usePlaywrightChromium = process.env.AUTH_E2E_BROWSER === "chromium";

  if (usePlaywrightChromium) {
    browserMode = "playwright-chromium";
    return {
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    };
  }

  browserMode = "chrome-persistent";
  return {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: { width: 1400, height: 900 },
  };
}

async function openAuthE2eBrowser() {
  const launchOptions = buildBrowserLaunchOptions();
  const usePlaywrightChromium = process.env.AUTH_E2E_BROWSER === "chromium";

  if (usePlaywrightChromium) {
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });
    const page = await context.newPage();
    return { browser, context, page, close: () => browser.close() };
  }

  const context = await chromium.launchPersistentContext(
    chromeProfileDir,
    launchOptions,
  );
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser: null, context, page, close: () => context.close() };
}

console.log(`[auth:e2e] Opening ${adminUrl}`);
console.log(
  `[auth:e2e] Browser: ${browserMode} (profile: ${chromeProfileDir})`,
);
console.log(
  "[auth:e2e] Tip: if Google blocks sign-in, use Shopify email/password or set AUTH_E2E_BROWSER=chromium only for cookie tracing.",
);

const { page, close: closeBrowser } = await openAuthE2eBrowser();

page.on("response", async (response) => {
  try {
    const url = response.url();
    if (
      !url.includes("/app") &&
      !url.includes("/auth") &&
      !url.startsWith(appUrl)
    ) {
      return;
    }

    const headers = response.headers();
    const entry = {
      url,
      status: response.status(),
      setCookieCount: countSetCookie(headers),
    };

    if (url.includes("/auth/callback")) {
      const requestHeaders = response.request().headers();
      entry.cookieHeader = requestHeaders.cookie ?? null;
    }

    navigations.push(entry);
    console.log(
      `[auth:e2e] ${response.status()} ${url}${entry.setCookieCount ? ` Set-Cookie=${entry.setCookieCount}` : ""}`,
    );
  } catch {
    // Ignore response logging errors.
  }
});

try {
  await page.goto(adminUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

  const rl = createInterface({ input, output });
  await rl.question(
    "Complete Shopify OAuth approval in the browser, then press Enter.\n",
  );
  rl.close();

  await page.waitForTimeout(3000);
  finalPageText = (await page.locator("body").innerText()).slice(0, 1200);

  const reachedApp = navigations.some(
    (nav) => nav.url.includes("/app") && nav.status === 200,
  );
  const callbackNav = navigations.find((nav) =>
    nav.url.includes("/auth/callback"),
  );

  if (!reachedApp || (callbackNav?.status && callbackNav.status >= 400)) {
    failureScreenshot = join(
      screenshotDir,
      `auth-e2e-failure-${Date.now()}.png`,
    );
    await page.screenshot({ path: failureScreenshot, fullPage: true });
  }
} catch (error) {
  failureScreenshot = join(screenshotDir, `auth-e2e-error-${Date.now()}.png`);
  await page.screenshot({ path: failureScreenshot, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await closeBrowser();
}

const callbackNav = navigations.find((nav) => nav.url.includes("/auth/callback"));
const auth302 = navigations.find(
  (nav) =>
    nav.url.includes(`${appUrl}/auth`) &&
    nav.status &&
    nav.status >= 300 &&
    nav.status < 400,
);

const e2eSummary = [
  `Browser mode: ${browserMode}`,
  `Admin URL: ${adminUrl}`,
  `Navigations captured: ${navigations.length}`,
  `Auth Set-Cookie observed: ${auth302?.setCookieCount ?? 0}`,
  `Callback status: ${callbackNav?.status ?? "not seen"}`,
  `Callback Cookie header present: ${Boolean(callbackNav?.cookieHeader)}`,
  `Final page excerpt: ${finalPageText.slice(0, 200).replace(/\s+/g, " ")}`,
  failureScreenshot ? `Screenshot: ${failureScreenshot}` : "Screenshot: none",
].join("\n");

writeFileSync(
  join(process.cwd(), ".auth-debug", "last-e2e.json"),
  JSON.stringify({ navigations, finalPageText, failureScreenshot }, null, 2),
  "utf8",
);

const report = {
  generatedAt: new Date().toISOString(),
  lastFlowOutcome:
    callbackNav?.status && callbackNav.status < 400 ? "success" : "failure",
  flowId: null,
  lastFailingRoute: callbackNav?.url ?? navigations.at(-1)?.url ?? null,
  likelyRootCause: callbackNav?.cookieHeader
    ? "Callback received Cookie header — inspect authenticate.admin/session persistence if /app still fails."
    : auth302?.setCookieCount
      ? "Auth set cookies but callback missing Cookie header — Safari/third-party cookie issue."
      : "Auth begin did not emit Set-Cookie before callback.",
  nextAction: failureScreenshot
    ? `Review screenshot ${failureScreenshot} and auth-debug-report.md navigations.`
    : "Run npm run auth:doctor -- --shop <shop> to verify env + Prisma session.",
  checks: [],
  e2eSummary,
  navigations,
};

const outputPath = writeAuthDebugReport(report);
console.log(`\n[auth:e2e] Wrote ${outputPath}`);
if (failureScreenshot) {
  console.log(`[auth:e2e] Failure screenshot: ${failureScreenshot}`);
}
