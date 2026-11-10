// Owner: R2. Tasks F-2 to F-4: SQLite schema, windowed loader, normalizer, fixtures, hybrid store.
export {
  createPaypalClientFromEnv,
  getMerchantDataset,
  loadTransactions,
  type MerchantDataset,
} from "./windowedLoader.js";
export {
  decimalToSignedCents,
  hashPayerEmail,
  normalizeTransaction,
  transactionKindFor,
  transactionStatusFor,
} from "./normalizer.js";
export {
  isPersonaMerchant,
  loadFixtureDataset,
  seedFixtures,
  type FixtureDatasetFile,
} from "./seedFixtures.js";
