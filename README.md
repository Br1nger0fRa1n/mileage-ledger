# Mileage Ledger — v1

Strava mileage → spending balance tracker. Credits from activities, debits from
bank transactions, balance is always computed live from the two.

## What's in v1

- Strava webhook → credit (per-activity-type rates, tunable via `.env`)
- Plaid webhook → debit (one connected card/account)
- Current balance, lifetime earned, lifetime spent (all computed, never stored directly)
- Earnings by activity type / spending by category breakdowns
- Manual entry fallback (`/api/manual/activity`, `/api/manual/transaction`)
- Basic frontend (balance + breakdowns + history + "Connect Bank" button)

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` (from strava.com/settings/api)
   - `PLAID_CLIENT_ID` / `PLAID_SECRET` (from dashboard.plaid.com — use Sandbox keys first)
   - `DATABASE_URL` (a local Postgres, or point straight at your Railway Postgres)
3. Create the tables: `npm run db:init`
4. Start the server: `npm run dev`
5. Visit `http://localhost:3000/strava/auth` once to connect your Strava account
   (make sure Strava's "Authorization Callback Domain" is set to `localhost` for this)
6. Visit `http://localhost:3000` to see the dashboard and connect a bank via Plaid Sandbox

## Deploying to Railway

1. Push this repo to GitHub
2. In Railway: New Project → Deploy from GitHub repo
3. Add a Postgres service to the same project — Railway auto-injects `DATABASE_URL`
4. Add the rest of your `.env` values as Railway environment variables (Settings → Variables)
5. Set `PUBLIC_URL` to your generated Railway domain, e.g. `https://yourapp-production.up.railway.app`
   (no trailing slash)
6. Once deployed, run the DB init once — either via Railway's one-off command feature,
   or temporarily add `node src/db/init.js &&` to the start command for the first deploy
7. Update Strava's "Authorization Callback Domain" to your real Railway domain (bare domain, no `https://`)
8. Update Plaid's redirect URI allowlist in the Dashboard to `https://yourapp.../plaid/oauth-redirect`
9. Register the Strava webhook subscription (one-time, via curl — see below)
10. Switch `PLAID_ENV` to `production` and swap in production keys once you're ready to link your real bank

## Registering the Strava webhook subscription (one-time)

Strava webhooks need to be registered once via a direct API call (there's no UI for this):

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F "callback_url=https://yourapp.up.railway.app/strava/webhook" \
  -F "verify_token=YOUR_STRAVA_VERIFY_TOKEN"
```

Strava will immediately GET your `/strava/webhook` endpoint to verify it — make sure
the app is deployed and reachable *before* running this.

## Not in v1 (see roadmap)

Categorization overrides UI, goals, rolls/multipliers, push notifications, insights,
historical import, AI features — all planned for v2+.
