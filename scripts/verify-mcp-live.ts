/**
 * Owner: R2. Task H-8: live PayPal MCP verification.
 *
 * Run from the repository root (the root package.json is R1-owned, so this task does
 * not add a package script):
 *
 *   pnpm exec tsx scripts/verify-mcp-live.ts
 *
 * What it does:
 * - Loads .env (or the shell environment) with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
 *   and optional PAYPAL_API_BASE through R1's PaypalClient. The import uses the package
 *   source path because the root workspace package does not declare @surplus/paypal and
 *   this task may not edit the R1-owned root package.json.
 * - Obtains a Sandbox access token through PaypalClient.getAccessToken().
 * - Calls connectPaypalMcp(accessToken) and invokes every read-only allowlisted tool.
 * - Prints availableTools, unavailableTools and only the sanitized page counts.
 *
 * It never prints the token, client credentials, raw MCP payloads or PayPal free text.
 * Exit code 0 requires all three required tools (list_transactions, list_disputes,
 * get_merchant_insights) to be discovered and every sanitized output to contain no key
 * named note, custom_id, subject or messages.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PaypalClient } from "../packages/paypal/src/index.js";
import { connectPaypalMcp, READ_ONLY_MCP_TOOLS } from "../apps/api/src/agent/mcpClient.js";
import type { SanitizedMcpOutput } from "../apps/api/src/agent/mcpSanitizer.js";

const FORBIDDEN_KEYS = new Set(["note", "custom_id", "subject", "messages"]);

export interface VerifyMcpLiveResult {
  ok: boolean;
  availableTools: string[];
  unavailableTools: string[];
  sanitizedOutputs: Record<string, SanitizedMcpOutput>;
}

function loadEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch {
    // .env is optional; shell or CI environment variables are equally valid.
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_ENV_${name}`);
  return value;
}

function forbiddenKeys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenKeys(item, `${prefix}[${index}]`));
  }
  if (value === null || typeof value !== "object") return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const location = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) found.push(location);
    found.push(...forbiddenKeys(child, location));
  }
  return found;
}

// Defensive projection: even if the sanitizer regressed at runtime, only integer counts
// can ever be printed or returned by this script.
function safeCounts(value: unknown): SanitizedMcpOutput {
  const safe: SanitizedMcpOutput = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return safe;
  const record = value as Record<string, unknown>;
  for (const key of ["recordsOnPage", "totalItems", "totalPages"] as const) {
    const count = record[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
      safe[key] = count;
    }
  }
  return safe;
}

export async function verifyMcpLive(): Promise<VerifyMcpLiveResult> {
  loadEnv();

  const client = new PaypalClient({
    clientId: requireEnv("PAYPAL_CLIENT_ID"),
    clientSecret: requireEnv("PAYPAL_CLIENT_SECRET"),
    baseUrl: process.env["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com",
  });
  const accessToken = await client.getAccessToken();

  const session = await connectPaypalMcp(accessToken);
  const sanitizedOutputs: Record<string, SanitizedMcpOutput> = {};
  let ok = true;

  try {
    console.log(
      JSON.stringify(
        {
          availableTools: session.availableTools,
          unavailableTools: session.unavailableTools,
        },
        null,
        2,
      ),
    );

    for (const name of READ_ONLY_MCP_TOOLS) {
      const toolName = `paypal_mcp_${name}`;
      const mcpTool = session.tools[toolName];
      if (!mcpTool?.execute) {
        ok = false;
        console.log(`${toolName}: UNAVAILABLE`);
        continue;
      }

      try {
        const raw = await mcpTool.execute({}, { toolCallId: `verify-${name}`, messages: [] });
        const output = safeCounts(raw);
        sanitizedOutputs[toolName] = output;
        const leaks = forbiddenKeys(raw);
        if (leaks.length > 0) {
          ok = false;
          console.log(`${toolName}: FORBIDDEN_KEYS_PRESENT (${leaks.length})`);
        } else {
          console.log(`${toolName}: ${JSON.stringify(output)}`);
        }
      } catch {
        // Upstream errors can carry URLs, tokens or PayPal free text. Never print them.
        ok = false;
        console.log(`${toolName}: READ_FAILED`);
      }
    }
  } finally {
    await session.close();
  }

  const allRequiredDiscovered = READ_ONLY_MCP_TOOLS.every((name) =>
    session.availableTools.includes(name),
  );
  if (!allRequiredDiscovered || session.unavailableTools.length > 0) ok = false;

  const result: VerifyMcpLiveResult = {
    ok,
    availableTools: session.availableTools,
    unavailableTools: session.unavailableTools,
    sanitizedOutputs,
  };
  console.log(JSON.stringify({ ok: result.ok }, null, 2));
  return result;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return "UNEXPECTED_FAILURE";
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  verifyMcpLive()
    .then((result) => {
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((error: unknown) => {
      console.error(`verify:mcp failed (${safeErrorCode(error)})`);
      process.exitCode = 1;
    });
}
