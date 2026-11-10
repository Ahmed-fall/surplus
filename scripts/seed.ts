// Owner: R2. Task F-4: deterministic four-persona + hybrid live_sandbox seeding.
//
// Populates the repository-root SQLite database from the JSON fixtures under
// /fixtures. Idempotent and offline: re-seeding overwrites the same rows and
// finishes well under two seconds even on cold start.
import { getDb } from "@surplus/paypal/db";
import { seedFixtures } from "@surplus/paypal/sources";

const db = getDb();
const start = performance.now();
const seeded = seedFixtures(db);
const elapsed = Math.round(performance.now() - start);

for (const { merchantId, transactionCount } of seeded) {
  console.log(
    `${merchantId}: ${transactionCount} transactions, ` +
      `${db.prepare("SELECT COUNT(*) AS count FROM open_disputes WHERE merchantId = ?").get(merchantId).count} open disputes`,
  );
}
console.log(`seed complete in ${elapsed}ms (surplus.db)`);
