const { pool } = require('../db');
const { rateFor } = require('../config/rates');

const METERS_PER_MILE = 1609.344;

/**
 * Records a credit from a Strava activity.
 * Idempotent on strava_id -- safe to call twice for the same activity
 * (webhooks can arrive more than once).
 */
async function recordActivityCredit({ stravaId, activityType, distanceMeters, startedAt, source = 'strava' }) {
  const distanceMiles = distanceMeters / METERS_PER_MILE;
  const rate = rateFor(activityType);
  // v1: no active multiplier yet (that's a v3 feature) -- always 1.0 for now.
  const multiplier = 1.0;
  const creditAmount = Math.round(distanceMiles * rate * multiplier * 100) / 100;

  const result = await pool.query(
    `INSERT INTO activities (strava_id, activity_type, distance_miles, rate_per_mile, multiplier, credit_amount, started_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (strava_id) DO NOTHING
     RETURNING *`,
    [stravaId, activityType, distanceMiles.toFixed(3), rate, multiplier, creditAmount, startedAt, source]
  );

  return result.rows[0] || null; // null means it already existed
}

/**
 * Records a debit from a Plaid transaction.
 * Idempotent on plaid_transaction_id.
 */
async function recordTransactionDebit({ plaidTransactionId, merchantName, amount, plaidCategory, postedAt, pending = false, source = 'plaid' }) {
  const result = await pool.query(
    `INSERT INTO transactions (plaid_transaction_id, merchant_name, amount, plaid_category, posted_at, pending, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (plaid_transaction_id) DO UPDATE
       SET amount = EXCLUDED.amount, pending = EXCLUDED.pending
     RETURNING *`,
    [plaidTransactionId, merchantName, amount, plaidCategory, postedAt, pending, source]
  );

  return result.rows[0];
}

/** Current spendable balance = lifetime earned - lifetime spent (excluding flagged transactions). */
async function getBalanceSummary() {
  const { rows } = await pool.query(`
    SELECT
      COALESCE((SELECT SUM(credit_amount) FROM activities), 0) AS lifetime_earned,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE excluded = false), 0) AS lifetime_spent
  `);
  const lifetimeEarned = parseFloat(rows[0].lifetime_earned);
  const lifetimeSpent = parseFloat(rows[0].lifetime_spent);
  return {
    currentBalance: Math.round((lifetimeEarned - lifetimeSpent) * 100) / 100,
    lifetimeEarned,
    lifetimeSpent,
  };
}

/** $ earned broken down by activity type -- e.g. { Run: 54, Ride: 12 } */
async function getEarningsByActivityType() {
  const { rows } = await pool.query(`
    SELECT activity_type, SUM(credit_amount) AS total
    FROM activities
    GROUP BY activity_type
    ORDER BY total DESC
  `);
  return rows.map((r) => ({ activityType: r.activity_type, total: parseFloat(r.total) }));
}

/** $ spent broken down by category (uses manual override if set, else Plaid's category) */
async function getSpendingByCategory() {
  const { rows } = await pool.query(`
    SELECT COALESCE(category_override, plaid_category, 'Uncategorized') AS category, SUM(amount) AS total
    FROM transactions
    WHERE excluded = false
    GROUP BY category
    ORDER BY total DESC
  `);
  return rows.map((r) => ({ category: r.category, total: parseFloat(r.total) }));
}

/** Recent ledger activity, credits and debits interleaved, newest first. */
async function getRecentLedger(limit = 50) {
  const { rows } = await pool.query(`
    (SELECT 'credit' AS kind, activity_type AS label, credit_amount AS amount, started_at AS occurred_at
     FROM activities)
    UNION ALL
    (SELECT 'debit' AS kind, COALESCE(merchant_name, 'Unknown') AS label, amount, posted_at AS occurred_at
     FROM transactions WHERE excluded = false)
    ORDER BY occurred_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

module.exports = {
  recordActivityCredit,
  recordTransactionDebit,
  getBalanceSummary,
  getEarningsByActivityType,
  getSpendingByCategory,
  getRecentLedger,
};
