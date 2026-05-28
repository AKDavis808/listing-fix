import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EXPECTED_PRODUCTION_APP_URL =
  "https://listing-fix-production.up.railway.app";

export function loadDotEnv(rootDir = process.cwd()) {
  const envPath = join(rootDir, ".env");
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env optional for doctor
  }
}

export function parseShopifyAppToml(rootDir = process.cwd()) {
  const tomlPath = join(rootDir, "shopify.app.toml");
  const content = readFileSync(tomlPath, "utf8");
  const applicationUrl =
    content.match(/^application_url\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const redirectUrls = [...content.matchAll(/^\s*"([^"]+)"/gm)]
    .map((match) => match[1])
    .filter((url) => url.includes("/auth/"));

  const webhookUris = [...content.matchAll(/^\s*uri\s*=\s*"([^"]+)"/gm)].map(
    (match) => match[1],
  );

  const scopesMatch = content.match(/^scopes\s*=\s*"([^"]+)"/m);
  const scopes = scopesMatch?.[1]?.split(",").map((s) => s.trim()) ?? [];
  const clientId = content.match(/^client_id\s*=\s*"([^"]+)"/m)?.[1] ?? null;

  return { applicationUrl, redirectUrls, webhookUris, scopes, clientId, tomlPath };
}

export function writeAuthDebugReport(report, rootDir = process.cwd()) {
  const lines = [
    "# ListingFix Auth Debug Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Last auth flow result",
    "",
    `- Outcome: **${report.lastFlowOutcome ?? "unknown"}**`,
    `- Flow ID: ${report.flowId ?? "n/a"}`,
    `- Last failing route: ${report.lastFailingRoute ?? "n/a"}`,
    "",
    "## Likely root cause",
    "",
    report.likelyRootCause ?? "Run auth:e2e to capture a fresh flow.",
    "",
    "## Exact next action",
    "",
    report.nextAction ?? "Run `npm run auth:doctor` and fix any failed checks.",
    "",
    "## Doctor checks",
    "",
    ...report.checks.map(
      (check) =>
        `- [${check.ok ? "x" : " "}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`,
    ),
    "",
  ];

  if (report.e2eSummary) {
    lines.push("## E2E summary", "", report.e2eSummary, "");
  }

  if (report.navigations?.length) {
    lines.push("## Navigations", "");
    for (const nav of report.navigations) {
      lines.push(
        `- ${nav.status ?? "?"} ${nav.url}${nav.setCookieCount != null ? ` (Set-Cookie: ${nav.setCookieCount})` : ""}`,
      );
    }
    lines.push("");
  }

  const outputPath = join(rootDir, "auth-debug-report.md");
  writeFileSync(outputPath, lines.join("\n"), "utf8");

  const debugDir = join(rootDir, ".auth-debug");
  mkdirSync(debugDir, { recursive: true });
  writeFileSync(
    join(debugDir, "last-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  return outputPath;
}

export function readLastFlowSnapshot(rootDir = process.cwd()) {
  try {
    const raw = readFileSync(
      join(rootDir, ".auth-debug", "last-flow.json"),
      "utf8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
