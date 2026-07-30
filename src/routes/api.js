const express = require('express');
const ledger = require('../lib/ledger');

const router = express.Router();

router.get('/balance', async (req, res) => {
  const summary = await ledger.getBalanceSummary();
  res.json(summary);
});

router.get('/earnings-by-type', async (req, res) => {
  res.json(await ledger.getEarningsByActivityType());
});

router.get('/spending-by-category', async (req, res) => {
  res.json(await ledger.getSpendingByCategory());
});

router.get('/history', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(await ledger.getRecentLedger(limit));
});

// Manual entry fallback -- for when Strava/Plaid sync lags or misses something.
router.post('/manual/activity', async (req, res) => {
  const { activityType, distanceMiles, startedAt } = req.body;
  if (!activityType || !distanceMiles) {
    return res.status(400).json({ error: 'activityType and distanceMiles are required' });
  }
  const { rateFor } = require('../config/rates');
  const rate = rateFor(activityType);
  const creditAmount = Math.round(distanceMiles * rate * 100) / 100;

  const { pool } = require('../db');
  const result = await pool.query(
    `INSERT INTO activities (strava_id, activity_type, distance_miles, rate_per_mile, multiplier, credit_amount, started_at, source)
     VALUES ($1, $2, $3, $4, 1.0, $5, $6, 'manual')
     RETURNING *`,
    [-Date.now(), activityType, distanceMiles, rate, creditAmount, startedAt || new Date()]
  );
  res.json(result.rows[0]);
});

router.post('/manual/transaction', async (req, res) => {
  const { merchantName, amount, category, postedAt } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount is required' });

  const saved = await ledger.recordTransactionDebit({
    plaidTransactionId: `manual-${Date.now()}`,
    merchantName: merchantName || 'Manual entry',
    amount,
    plaidCategory: category || null,
    postedAt: postedAt || new Date(),
  });
  res.json(saved);
});

// --- v2: category overrides + excluded flag ---

router.patch('/transactions/:id/category', async (req, res) => {
  const { category } = req.body;
  const updated = await ledger.setCategoryOverride(req.params.id, category);
  if (!updated) return res.status(404).json({ error: 'Transaction not found' });
  res.json(updated);
});

router.patch('/transactions/:id/exclude', async (req, res) => {
  const { excluded } = req.body;
  const updated = await ledger.setTransactionExcluded(req.params.id, !!excluded);
  if (!updated) return res.status(404).json({ error: 'Transaction not found' });
  res.json(updated);
});

// --- v2: goals ---

router.get('/goals', async (req, res) => {
  res.json(await ledger.getGoalsWithProgress());
});

router.post('/goals', async (req, res) => {
  const { name, targetAmount, targetDate, locked } = req.body;
  if (!name || !targetAmount) {
    return res.status(400).json({ error: 'name and targetAmount are required' });
  }
  const goal = await ledger.createGoal({ name, targetAmount, targetDate, locked });
  res.json(goal);
});

router.patch('/goals/:id', async (req, res) => {
  const { name, targetAmount, targetDate, locked } = req.body;
  const updated = await ledger.updateGoal(req.params.id, { name, targetAmount, targetDate, locked });
  if (!updated) return res.status(404).json({ error: 'Goal not found' });
  res.json(updated);
});

router.delete('/goals/:id', async (req, res) => {
  await ledger.deleteGoal(req.params.id);
  res.json({ success: true });
});

router.get('/goal-warnings', async (req, res) => {
  res.json(await ledger.getGoalWarnings());
});

// --- v2: settings (low balance threshold) ---

router.get('/settings', async (req, res) => {
  res.json(await ledger.getSettings());
});

router.put('/settings', async (req, res) => {
  const { lowBalanceThreshold } = req.body;
  res.json(await ledger.updateSettings({ lowBalanceThreshold }));
});

module.exports = router;
