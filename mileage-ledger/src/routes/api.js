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

module.exports = router;
