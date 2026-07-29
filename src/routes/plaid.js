const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { pool } = require('../db');
const { recordTransactionDebit } = require('../lib/ledger');

const router = express.Router();

const plaidClient = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
);

// ---------------------------------------------------------------------------
// Step 1: frontend calls this to get a link_token, then hands it to Plaid
// Link's SDK to open the "connect your bank" UI.
// ---------------------------------------------------------------------------
router.post('/link-token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'single-user' }, // single-user app, static ID is fine
      client_name: 'Mileage Ledger',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
      webhook: `${process.env.PUBLIC_URL}/plaid/webhook`,
      redirect_uri: `${process.env.PUBLIC_URL}/plaid/oauth-redirect`,
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error('Failed to create link token:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

// ---------------------------------------------------------------------------
// Step 2: after the user finishes Link in the browser, the frontend sends
// the public_token here. Exchange it for a permanent access_token and store it.
// ---------------------------------------------------------------------------
router.post('/exchange-token', async (req, res) => {
  const { public_token } = req.body;
  try {
    const response = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = response.data;

    await pool.query(
      `INSERT INTO plaid_items (item_id, access_token)
       VALUES ($1, $2)
       ON CONFLICT (item_id) DO UPDATE SET access_token = EXCLUDED.access_token`,
      [item_id, access_token]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to exchange public token:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Some banks route through here after their own OAuth step. Plaid Link
// handles re-entering the flow client-side; this just needs to exist and
// serve *something* so the redirect doesn't 404.
router.get('/oauth-redirect', (req, res) => {
  res.send('<script>window.close();</script>Redirect complete, you can close this tab.');
});

// ---------------------------------------------------------------------------
// Pulls new/updated transactions using the stored cursor, applies each as
// a debit, and saves the new cursor for next time. Idempotent.
// ---------------------------------------------------------------------------
async function syncTransactionsForItem(item) {
  let cursor = item.cursor;
  let added = [];
  let hasMore = true;

  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: item.access_token,
      cursor: cursor || undefined,
    });
    added = added.concat(response.data.added);
    hasMore = response.data.has_more;
    cursor = response.data.next_cursor;
  }

  for (const txn of added) {
    // Plaid represents money OUT of the account as a positive amount already.
    await recordTransactionDebit({
      plaidTransactionId: txn.transaction_id,
      merchantName: txn.merchant_name || txn.name,
      amount: txn.amount,
      plaidCategory: txn.personal_finance_category?.primary || txn.category?.[0] || null,
      postedAt: txn.date,
      pending: txn.pending,
    });
  }

  await pool.query('UPDATE plaid_items SET cursor = $1 WHERE item_id = $2', [cursor, item.item_id]);
  return added.length;
}

// ---------------------------------------------------------------------------
// Plaid webhook -- fires SYNC_UPDATES_AVAILABLE when new transactions exist.
// ---------------------------------------------------------------------------
router.post('/webhook', express.json(), async (req, res) => {
  res.status(200).send('ok'); // ack immediately, process after

  const { webhook_type, webhook_code, item_id } = req.body;
  if (webhook_type !== 'TRANSACTIONS') return;
  if (webhook_code !== 'SYNC_UPDATES_AVAILABLE') return;

  try {
    const { rows } = await pool.query('SELECT * FROM plaid_items WHERE item_id = $1', [item_id]);
    if (rows.length === 0) return console.error('Webhook for unknown item_id:', item_id);

    const count = await syncTransactionsForItem(rows[0]);
    console.log(`Synced ${count} new transaction(s) for item ${item_id}`);
  } catch (err) {
    console.error('Failed to process Plaid webhook:', err.response?.data || err.message);
  }
});

module.exports = { router, syncTransactionsForItem };
