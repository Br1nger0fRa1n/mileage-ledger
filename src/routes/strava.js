const express = require('express');
const axios = require('axios');
const { pool } = require('../db');
const { recordActivityCredit } = require('../lib/ledger');

const router = express.Router();

const STRAVA_OAUTH_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

// ---------------------------------------------------------------------------
// Step 1: kick off OAuth. Visit /strava/auth in a browser (once) to connect
// your Strava account. Redirects you to Strava's consent screen.
// ---------------------------------------------------------------------------
router.get('/auth', (req, res) => {
  const redirectUri = `${process.env.PUBLIC_URL}/strava/callback`;
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', process.env.STRAVA_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'auto');
  // activity:read_all -- needed to see private activities too
  url.searchParams.set('scope', 'activity:read_all');
  res.redirect(url.toString());
});

// ---------------------------------------------------------------------------
// Step 2: Strava redirects here with a ?code=... after you approve.
// Exchange it for access + refresh tokens and store them.
// ---------------------------------------------------------------------------
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Strava auth error: ${error}`);

  try {
    const { data } = await axios.post(STRAVA_OAUTH_URL, {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    });

    await pool.query(
      `INSERT INTO strava_tokens (athlete_id, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (athlete_id) DO UPDATE
         SET access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()`,
      [data.athlete.id, data.access_token, data.refresh_token, data.expires_at]
    );

    res.send('Strava connected. You can close this tab.');
  } catch (err) {
    console.error('Strava token exchange failed. Full error:', err);
    res.status(500).send('Strava token exchange failed. Check server logs.');
  }
});

// ---------------------------------------------------------------------------
// Refreshes the stored access token if it's expired. Strava access tokens
// are short-lived (a few hours); refresh tokens are long-lived.
// ---------------------------------------------------------------------------
async function getValidAccessToken() {
  const { rows } = await pool.query('SELECT * FROM strava_tokens ORDER BY id DESC LIMIT 1');
  if (rows.length === 0) throw new Error('No Strava account connected yet. Visit /strava/auth first.');

  const token = rows[0];
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (token.expires_at > nowSeconds + 60) {
    return token.access_token; // still valid
  }

  // expired -- refresh it
  const { data } = await axios.post(STRAVA_OAUTH_URL, {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
  });

  await pool.query(
    `UPDATE strava_tokens SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now()
     WHERE athlete_id = $4`,
    [data.access_token, data.refresh_token, data.expires_at, token.athlete_id]
  );

  return data.access_token;
}

// ---------------------------------------------------------------------------
// Webhook subscription verification. Strava sends a GET with a challenge
// when you first register the subscription -- must echo it back exactly.
// ---------------------------------------------------------------------------
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
    return res.json({ 'hub.challenge': challenge });
  }
  return res.status(403).send('Verification failed');
}); 

// ---------------------------------------------------------------------------
// Actual webhook events land here whenever a new activity is created.
// Strava's webhook payload is intentionally thin (just IDs) -- you have to
// call the API to get the actual distance/type/etc.
// ---------------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  // Always 200 immediately -- Strava retries aggressively on non-200,
  // and we don't want to block the response on the API call below.
  res.status(200).send('EVENT_RECEIVED');

  const { object_type, aspect_type, object_id } = req.body;
  if (object_type !== 'activity' || aspect_type !== 'create') return;

  try {
    const accessToken = await getValidAccessToken();
    const { data: activity } = await axios.get(`${STRAVA_API_BASE}/activities/${object_id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const saved = await recordActivityCredit({
      stravaId: activity.id,
      activityType: activity.type,
      distanceMeters: activity.distance,
      startedAt: activity.start_date,
    });

    if (saved) {
      console.log(`Credited $${saved.credit_amount} for ${saved.activity_type} (${saved.distance_miles} mi)`);
    }
  } catch (err) {
    console.error('Failed to process Strava webhook event:', err.response?.data || err.message);
  }
});

module.exports = { router, getValidAccessToken };
