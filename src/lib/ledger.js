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
  if (amount < 0) return null;
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
    (SELECT NULL::bigint AS id, 'credit' AS kind, activity_type AS label, credit_amount AS amount,
            NULL AS category, started_at AS occurred_at
     FROM activities)
    UNION ALL
    (SELECT id, 'debit' AS kind, COALESCE(merchant_name, 'Unknown') AS label, amount,
            COALESCE(category_override, plaid_category, 'Uncategorized') AS category, posted_at AS occurred_at
     FROM transactions WHERE excluded = false)
    ORDER BY occurred_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

/** Sets or clears a manual category override on a transaction. */
async function setCategoryOverride(transactionId, category) {
  const { rows } = await pool.query(
    `UPDATE transactions SET category_override = $1 WHERE id = $2 RETURNING *`,
    [category || null, transactionId]
  );
  return rows[0];
}

/** Toggles whether a transaction counts against the balance (e.g. reimbursed, shared cost). */
async function setTransactionExcluded(transactionId, excluded) {
  const { rows } = await pool.query(
    `UPDATE transactions SET excluded = $1 WHERE id = $2 RETURNING *`,
    [excluded, transactionId]
  );
  return rows[0];
}

/** Creates a new goal. */
async function createGoal({ name, targetAmount, targetDate, locked = false }) {
  const { rows } = await pool.query(
    `INSERT INTO goals (name, target_amount, target_date, locked) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, targetAmount, targetDate || null, locked]
  );
  return rows[0];
}

/** Lists all goals with progress computed against the current balance. */
async function getGoalsWithProgress() {
  const { currentBalance } = await getBalanceSummary();
  const { rows } = await pool.query(`SELECT * FROM goals ORDER BY created_at ASC`);

  return rows.map((g) => {
    const targetAmount = parseFloat(g.target_amount);
    const progressAmount = Math.min(currentBalance, targetAmount);
    const progressPct = targetAmount > 0 ? Math.round((progressAmount / targetAmount) * 100) : 0;
    return {
      id: g.id,
      name: g.name,
      targetAmount,
      targetDate: g.target_date,
      locked: g.locked,
      achieved: currentBalance >= targetAmount,
      progressPct,
    };
  });
}

async function updateGoal(id, { name, targetAmount, targetDate, locked }) {
  const { rows } = await pool.query(
    `UPDATE goals SET
       name = COALESCE($1, name),
       target_amount = COALESCE($2, target_amount),
       target_date = COALESCE($3, target_date),
       locked = COALESCE($4, locked)
     WHERE id = $5 RETURNING *`,
    [name, targetAmount, targetDate, locked, id]
  );
  return rows[0];
}

async function deleteGoal(id) {
  await pool.query(`DELETE FROM goals WHERE id = $1`, [id]);
}

/**
 * Checks the current balance against any locked goals and returns a
 * warning message if spending has dipped below a protected goal amount.
 * This is a warning only -- never blocks a purchase, since debits are
 * recorded automatically from Plaid and can't be "rejected."
 */
async function getGoalWarnings() {
  const { currentBalance } = await getBalanceSummary();
  const { rows } = await pool.query(`SELECT * FROM goals WHERE locked = true`);

  return rows
    .filter((g) => currentBalance < parseFloat(g.target_amount))
    .map((g) => ({
      goalId: g.id,
      goalName: g.name,
      targetAmount: parseFloat(g.target_amount),
      currentBalance,
      shortfall: Math.round((parseFloat(g.target_amount) - currentBalance) * 100) / 100,
    }));
}

async function getSettings() {
  const { rows } = await pool.query(`SELECT * FROM settings WHERE id = 1`);
  return { lowBalanceThreshold: parseFloat(rows[0].low_balance_threshold) };
}

async function updateSettings({ lowBalanceThreshold }) {
  const { rows } = await pool.query(
    `UPDATE settings SET low_balance_threshold = COALESCE($1, low_balance_threshold) WHERE id = 1 RETURNING *`,
    [lowBalanceThreshold]
  );
  return { lowBalanceThreshold: parseFloat(rows[0].low_balance_threshold) };
}

module.exports = {
  recordActivityCredit,
  recordTransactionDebit,
  getBalanceSummary,
  getEarningsByActivityType,
  getSpendingByCategory,
  getRecentLedger,
  setCategoryOverride,
  setTransactionExcluded,
  createGoal,
  getGoalsWithProgress,
  updateGoal,
  deleteGoal,
  getGoalWarnings,
  getSettings,
  updateSettings,
};
