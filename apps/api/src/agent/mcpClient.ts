// Owner: R4 (cross-owner change by R1 under H-3, approval tracked in issue).
// Task S-5/H-3: MCP client connecting to PayPal Sandbox MCP (SSE transport).
//
// Uses experimental_createMCPClient from "ai" to discover read-only MCP tools,
// wraps them through sanitizeMcpOutput so no PayPal free text reaches the LLM.
//
// IMPORTANT: paypal_mcp_get_merchant_insights is discovered but FILTERED OUT
// before being passed to the model, because ToolTraceEntry.toolName in
// @surplus/contracts does not include it. The contracts are frozen (R3 owns them
// exclusively). We keep the discovery check in hasAllRequiredReadOnlyTools so
// R4 can add it to contracts in a future cycle. See docs/decisions.md.
import { experimental_createMCPClient, tool } from "ai";
import type { Tool, ToolExecutionOptions } from "ai";
import { sanitizeMcpOutput } from "./mcpSanitizer.js";
import type { SanitizedMcpOutput } from "./mcpSanitizer.js";

/** All read-only tools the MCP server is expected to surface. */
export const READ_ONLY_MCP_TOOLS = [
  "list_transactions",
  "list_disputes",
  "get_merchant_insights",
] as const;

/**
 * Tools whose prefixed name is present in ToolTraceEntry.toolName (contracts).
 * Only these are passed to the model. get_merchant_insights is excluded because
 * contracts are frozen and do not include paypal_mcp_get_merchant_insights.
 */
export const CONTRACT_ALLOWED_MCP_TOOLS = [
  "list_transactions",
  "list_disputes",
] as const;

export const PAYPAL_SANDBOX_MCP_URL = "https://mcp.sandbox.paypal.com/sse";

type Client = Awaited<ReturnType<typeof experimental_createMCPClient>>;
type DiscoveredTools = Awaited<ReturnType<Client["tools"]>>;

interface McpTool {
  description?: string;
  parameters: DiscoveredTools[string]["parameters"];
  execute?: (args: unknown, options: ToolExecutionOptions) => PromiseLike<unknown>;
}

export type SafeMcpTool = Tool<McpTool["parameters"], SanitizedMcpOutput> & {
  execute: (args: unknown, options: ToolExecutionOptions) => PromiseLike<SanitizedMcpOutput>;
};

export type SafePaypalMcpTools = Record<string, SafeMcpTool>;

/**
 * Wraps discovered MCP tools: only read-only allowlisted tools are kept,
 * descriptions are replaced (never copy server-side text), and execution
 * output is sanitized. Upstream errors are replaced with a constant safe error.
 */
export function wrapReadOnlyMcpTools(discovered: Record<string, McpTool>): SafePaypalMcpTools {
  const safe: SafePaypalMcpTools = {};
  for (const name of READ_ONLY_MCP_TOOLS) {
    const source = discovered[name];
    if (!source?.execute) continue;
    const execute = source.execute;
    safe[`paypal_mcp_${name}`] = tool({
      description: `Read PayPal ${name.replaceAll("_", " ")}. Returns sanitized page counts only.`,
      parameters: source.parameters,
      execute: async (args, options) => {
        try {
          return sanitizeMcpOutput(await execute(args, options));
        } catch {
          // Upstream errors may contain URLs, credentials or PayPal free text.
          throw new Error("PAYPAL_MCP_READ_FAILED");
        }
      },
    });
  }
  return safe;
}

/** Check that all required read-only tools were discovered. */
export function hasAllRequiredReadOnlyTools(tools: SafePaypalMcpTools): boolean {
  return READ_ONLY_MCP_TOOLS.every((name) => tools[`paypal_mcp_${name}`] !== undefined);
}

/**
 * Returns only the MCP tools whose prefixed name is in the contracts
 * ToolTraceEntry.toolName union. get_merchant_insights is filtered out.
 */
export function contractAllowedMcpTools(tools: SafePaypalMcpTools): SafePaypalMcpTools {
  const allowed: SafePaypalMcpTools = {};
  for (const name of CONTRACT_ALLOWED_MCP_TOOLS) {
    const key = `paypal_mcp_${name}`;
    const t = tools[key];
    if (t) allowed[key] = t;
  }
  return allowed;
}

/** Pass an explicit Sandbox token; never read AI keys or PayPal client secrets here. */
export async function connectPaypalMcp(accessToken: string): Promise<{
  tools: SafePaypalMcpTools;
  availableTools: readonly string[];
  unavailableTools: readonly string[];
  close: () => Promise<void>;
}> {
  if (!accessToken.trim()) throw new Error("PAYPAL_ACCESS_TOKEN_REQUIRED");
  let client: Client;
  try {
    client = await experimental_createMCPClient({
      name: "surplus-paypal-sandbox",
      transport: {
        type: "sse",
        url: PAYPAL_SANDBOX_MCP_URL,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      onUncaughtError: () => {
        // Upstream text can contain sensitive data; keep it outside application logs.
      },
    });
  } catch {
    throw new Error("PAYPAL_MCP_CONNECTION_FAILED");
  }
  try {
    const discovered = await client.tools();
    const tools = wrapReadOnlyMcpTools(discovered);
    if (!hasAllRequiredReadOnlyTools(tools)) {
      throw new Error("PAYPAL_MCP_REQUIRED_TOOL_MISSING");
    }
    return {
      tools,
      availableTools: READ_ONLY_MCP_TOOLS.filter((name) => discovered[name] !== undefined),
      unavailableTools: READ_ONLY_MCP_TOOLS.filter((name) => discovered[name] === undefined),
      close: () => client.close(),
    };
  } catch (err) {
    await client.close();
    throw err;
  }
}

