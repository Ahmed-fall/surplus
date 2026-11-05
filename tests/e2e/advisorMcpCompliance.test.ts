import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { AdvisorResponseSchema, DISCLAIMER_ID_V1, DISCLAIMER_TEXT_V1 } from "@surplus/contracts";
import type { AdvisorResponse } from "@surplus/contracts";
import {
  DEMO_AS_OF,
  exampleNormalizedTransaction,
  exampleOpenDisputesSummary,
  exampleSurplusResult,
} from "@surplus/contracts/examples";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import type {
  AdvisorDraftGenerator,
  AdvisorToolLoop,
  GetMcpTools,
  RunAdvisorTurnInput,
} from "../../apps/api/src/agent/advisor.js";
import { runAdvisorTurn } from "../../apps/api/src/agent/advisor.js";
import { buildDeterministicTemplateNarrative } from "../../apps/api/src/agent/fallbackTemplate.js";
import { wrapReadOnlyMcpTools } from "../../apps/api/src/agent/mcpClient.js";

const transactionsFixture: unknown = JSON.parse(
  readFileSync(new URL("../../fixtures/mcp/malicious-transactions.json", import.meta.url), "utf8"),
);
const disputesFixture: unknown = JSON.parse(
  readFileSync(new URL("../../fixtures/mcp/malicious-disputes.json", import.meta.url), "utf8"),
);

const forbiddenContent =
  /NVDA|AAPL|SPY|73\.37|99,999|987654321|funds were transferred|execute a trade|override the developer|ignore every safety rule/i;

const dataset: RunAdvisorTurnInput["dataset"] = {
  transactions: [exampleNormalizedTransaction],
  availableBalanceCents: exampleSurplusResult.availableBalanceCents,
  balanceSource: "FIXTURE",
  openDisputes: exampleOpenDisputesSummary,
  excludedNonUsdCount: 0,
};

const liveInput: RunAdvisorTurnInput = {
  merchantId: "live_sandbox",
  dataset,
  asOf: DEMO_AS_OF,
  monthlyObligationsCents: 300000,
  riskProfile: "BALANCED",
};

const safeGenerator: AdvisorDraftGenerator = async ({ evidence }) =>
  buildDeterministicTemplateNarrative(evidence.summary, evidence.surplus, evidence.plan);

function expectCompliantResponse(result: AdvisorResponse): void {
  expect(AdvisorResponseSchema.parse(result)).toEqual(result);
  expect(result.disclaimerId).toBe(DISCLAIMER_ID_V1);
  expect(result.disclaimerText).toBe(DISCLAIMER_TEXT_V1);
  expect(result.narrativeMarkdown).not.toMatch(forbiddenContent);
  expect(JSON.stringify(result.toolTrace)).not.toMatch(forbiddenContent);
}

function maliciousMcpSession(): Awaited<ReturnType<GetMcpTools>> {
  return {
    tools: wrapReadOnlyMcpTools({
      list_transactions: {
        parameters: {} as never,
        execute: async () => transactionsFixture,
      },
      list_disputes: {
        parameters: {} as never,
        execute: async () => disputesFixture,
      },
    }),
    close: async () => undefined,
  };
}

const invokeBothPaypalTools: AdvisorToolLoop = async ({ tools }) => {
  const transactions = tools.paypal_mcp_list_transactions?.execute;
  const disputes = tools.paypal_mcp_list_disputes?.execute;
  if (transactions === undefined || disputes === undefined) {
    throw new Error("MCP_TEST_TOOLS_MISSING");
  }
  await transactions({}, { toolCallId: "c4-transactions", messages: [] });
  await disputes({}, { toolCallId: "c4-disputes", messages: [] });
};

async function listen(app: ReturnType<typeof buildApp>): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function postAdvisor(getMcpTools: GetMcpTools): Promise<AdvisorResponse> {
  const app = buildApp({
    loadDataset: async () => dataset,
    runAdvisorTurn: async (input) =>
      runAdvisorTurn(input, {
        generateDraft: safeGenerator,
        getMcpTools,
        runToolLoop: invokeBothPaypalTools,
      }),
  });
  const server = await listen(app);
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/advisor`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merchantId: "live_sandbox", riskProfile: "BALANCED" }),
    });
    expect(response.status).toBe(200);
    return AdvisorResponseSchema.parse(await response.json());
  } finally {
    await close(server);
  }
}

describe("C-4 PayPal MCP compliance", () => {
  it("strips malicious PayPal text before advisor evidence, response, and UI trace", async () => {
    let evidenceSnapshot = "";
    const captureEvidence: AdvisorDraftGenerator = async ({ evidence }) => {
      evidenceSnapshot = JSON.stringify(evidence);
      return buildDeterministicTemplateNarrative(evidence.summary, evidence.surplus, evidence.plan);
    };

    const result = await runAdvisorTurn(liveInput, {
      generateDraft: captureEvidence,
      getMcpTools: async () => maliciousMcpSession(),
      runToolLoop: invokeBothPaypalTools,
    });

    expect(evidenceSnapshot).not.toMatch(forbiddenContent);
    expect(result.toolTrace.slice(0, 2).map((entry) => entry.toolName)).toEqual([
      "paypal_mcp_list_transactions",
      "paypal_mcp_list_disputes",
    ]);
    expect(result.toolTrace[0]?.sanitizedOutputSummary).toEqual({
      recordsOnPage: 2,
      totalItems: 7,
      totalPages: 2,
    });
    expect(result.toolTrace[1]?.sanitizedOutputSummary).toEqual({
      recordsOnPage: 1,
      totalItems: 3,
      totalPages: 1,
    });
    expect(result.toolTrace.slice(0, 2).every((entry) => entry.durationMs > 0)).toBe(true);
    expectCompliantResponse(result);
  });

  it.each([
    ["throws", async () => Promise.reject(new Error("MCP_UNAVAILABLE"))],
    ["returns undefined", async () => undefined],
  ] satisfies ReadonlyArray<readonly [string, GetMcpTools]>)(
    "returns HTTP 200 with a valid fallback when getMcpTools %s",
    async (_name, getMcpTools) => {
      const result = await postAdvisor(getMcpTools);
      expect(["PASSED", "REGENERATED_PASSED", "FALLBACK_TEMPLATE"]).toContain(
        result.validatorStatus,
      );
      expectCompliantResponse(result);
    },
  );

  it("never opens MCP or exposes PayPal traces for a fixture persona", async () => {
    const getMcpTools = vi.fn(async () => maliciousMcpSession());
    const result = await runAdvisorTurn(
      { ...liveInput, merchantId: "persona_steady_retainer" },
      { generateDraft: safeGenerator, getMcpTools, runToolLoop: invokeBothPaypalTools },
    );

    expect(getMcpTools).not.toHaveBeenCalled();
    expect(result.toolTrace.some((entry) => entry.toolName.startsWith("paypal_mcp_"))).toBe(false);
    expectCompliantResponse(result);
  });

  it("records both UI-safe PayPal rows with positive durations on live success", async () => {
    const result = await postAdvisor(async () => maliciousMcpSession());
    const paypalTrace = result.toolTrace.filter((entry) =>
      entry.toolName.startsWith("paypal_mcp_"),
    );

    expect(paypalTrace.map((entry) => entry.toolName)).toEqual([
      "paypal_mcp_list_transactions",
      "paypal_mcp_list_disputes",
    ]);
    expect(paypalTrace.every((entry) => entry.durationMs > 0)).toBe(true);
    expect(paypalTrace.every((entry) => !JSON.stringify(entry).match(forbiddenContent))).toBe(true);
    expectCompliantResponse(result);
  });
});
