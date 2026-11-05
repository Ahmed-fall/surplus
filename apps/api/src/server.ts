// Owner: R1. Task C-5/C-12: API process entry point.
// Wires the real PaypalClient (when credentials exist), the SQLite-backed
// webhook store, R2's live dataset loader, R4's grounded advisor, the
// seed-on-boot reset, and then starts Express.
import { PayPalOrdersClient } from "@surplus/paypal";
import { getMerchantDataset } from "@surplus/paypal/sources";
import { buildApp } from "./app";
import { runAdvisorTurn } from "./agent/advisor";
import type { GetMcpTools } from "./agent/advisor";
import { connectPaypalMcp } from "./agent/mcpClient";
import type { DatasetLoader } from "./routes/dataset";
import { asOfFor, exampleDatasetLoader } from "./routes/dataset";
import { EMPTY_LIVE_DATASET, seedOnBoot } from "./routes/seed";
import { SseHub } from "./routes/sseHub";
import { SqliteWebhookStore } from "./routes/sqliteWebhookStore";
import { LIVE_MERCHANT } from "./routes/webhooks";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // .env is optional in CI and on fresh clones
}

const host = process.env["HOST"] ?? "127.0.0.1";
const port = Number(process.env["PORT"] ?? 4000);

const hub = new SseHub();
const store = new SqliteWebhookStore();
seedOnBoot(store);

const clientId = process.env["PAYPAL_CLIENT_ID"];
const clientSecret = process.env["PAYPAL_CLIENT_SECRET"];
const webhookId = process.env["PAYPAL_WEBHOOK_ID"];
const adminResetToken = process.env["ADMIN_RESET_TOKEN"] ?? "";
const apiBase = process.env["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com";

const client =
  clientId !== undefined && clientSecret !== undefined
    ? new PayPalOrdersClient({ clientId, clientSecret, baseUrl: apiBase })
    : undefined;

const getMcpTools: GetMcpTools | undefined =
  client === undefined
    ? undefined
    : async () => {
        try {
          const accessToken = await client.getAccessToken();
          return await connectPaypalMcp(accessToken);
        } catch {
          return undefined;
        }
      };

/** One lazy live sync per process; never copies fixture data into live_sandbox. */
let liveSync: Promise<void> | undefined;
function syncLive(): Promise<void> {
  if (client === undefined) return Promise.resolve();
  liveSync ??= getMerchantDataset(LIVE_MERCHANT, asOfFor(LIVE_MERCHANT), client)
    .then((dataset) => {
      store.hydrate(LIVE_MERCHANT, dataset);
    })
    .catch(() => {
      liveSync = undefined;
    });
  return liveSync;
}

const loadDataset: DatasetLoader = async (merchantId) => {
  if (merchantId !== LIVE_MERCHANT) {
    return store.getDataset(merchantId) ?? exampleDatasetLoader(merchantId);
  }
  const local = store.getDataset(merchantId);
  if (local !== undefined && local.transactions.length > 0) return local;
  await syncLive();
  return store.getDataset(LIVE_MERCHANT) ?? local ?? EMPTY_LIVE_DATASET;
};

const app = buildApp({
  loadDataset,
  runAdvisorTurn: (input) =>
    getMcpTools === undefined ? runAdvisorTurn(input) : runAdvisorTurn(input, { getMcpTools }),
  sseHub: hub,
  orders: client,
  webhook:
    client !== undefined && webhookId !== undefined
      ? {
          store,
          verify: (headers, rawBody) => client.verifyWebhookSignature(headers, rawBody, webhookId),
        }
      : undefined,
  admin: {
    token: adminResetToken,
    reset: async () => {
      liveSync = undefined;
      seedOnBoot(store);
    },
  },
});

hub.startHeartbeat(15_000);

app.listen(port, host, () => {
  console.log(`surplus-api listening on http://${host}:${port}`);
});
