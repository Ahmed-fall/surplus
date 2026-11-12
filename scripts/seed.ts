import { getDb } from "../packages/paypal/src/sources/db.js";

const db = getDb();
const asOf = new Date().toISOString();

const merchants = [
  { id: "persona_steady_retainer", name: "Steady Retainer" },
  { id: "persona_volatile_freelancer", name: "Volatile Freelancer" },
  { id: "persona_seasonal_seller", name: "Seasonal Seller" },
  { id: "persona_dispute_spike", name: "Dispute Spike" },
  { id: "live_sandbox", name: "Live Sandbox Merchant" },
];

const insertMerchant = db.prepare("INSERT OR REPLACE INTO merchants(id,name) VALUES(?,?)");
const insertTx = db.prepare(`INSERT OR REPLACE INTO normalized_transactions
(id,merchantId,occurredAt,monthBucket,kind,grossCents,feeCents,netCents,currency,status,counterpartyHash,source)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertBalance = db.prepare(
  "INSERT OR REPLACE INTO balances(merchantId,availableCents,withheldCents,asOf) VALUES(?,?,?,?)",
);
const insertDispute = db.prepare(
  "INSERT OR REPLACE INTO open_disputes(disputeId,merchantId,amountCents,status,createdAt) VALUES(?,?,?,?,?)",
);

db.transaction(() => {
  for (const m of merchants) insertMerchant.run(m.id, m.name);

  const personas: Record<string, { income: number; variance: number; disputes: number }> = {
    persona_steady_retainer: { income: 800000, variance: 50000, disputes: 0 },
    persona_volatile_freelancer: { income: 600000, variance: 400000, disputes: 100000 },
    persona_seasonal_seller: { income: 500000, variance: 300000, disputes: 50000 },
    persona_dispute_spike: { income: 700000, variance: 100000, disputes: 500000 },
    live_sandbox: { income: 750000, variance: 150000, disputes: 40000 },
  };

  for (const [merchantId, p] of Object.entries(personas)) {
    let balance = 1850000;
    for (let m = 0; m < 12; m++) {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() - (11 - m));
      const monthBucket = monthDate.toISOString().slice(0, 7);
      const occurredAt = `${monthBucket}-15T00:00:00.000Z`;
      const gross = p.income + (m % 2 === 0 ? p.variance : -p.variance);
      const fee = Math.round(gross * 0.03);
      insertTx.run(
        `fixture-${merchantId}-${m}`,
        merchantId,
        occurredAt,
        monthBucket,
        "income",
        gross,
        fee,
        gross - fee,
        "USD",
        "COMPLETED",
        "00000000",
        "fixture",
      );
      balance += gross - fee;
    }
    insertBalance.run(merchantId, balance, 0, asOf);
    if (p.disputes > 0) {
      insertDispute.run(`dispute-${merchantId}`, merchantId, p.disputes, "OPEN", asOf);
    }
  }
})();

console.log("seed: done");
