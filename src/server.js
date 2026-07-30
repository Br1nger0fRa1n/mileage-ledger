require('dotenv').config();
const express = require('express');
const path = require('path');

const { router: stravaRouter } = require('./routes/strava');
const { router: plaidRouter } = require('./routes/plaid');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const { sessionMiddleware, requireAuth } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);
// Strava/Plaid webhooks send JSON bodies -- parse for all routes except
// Plaid's webhook, which applies its own json() middleware inline
// (kept identical here for simplicity; express.json() is idempotent-safe).
app.use(express.json());
app.use(sessionMiddleware);

// Login routes must stay open (no auth required to reach them, obviously).
app.use('/', authRouter);
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));

// Strava/Plaid webhooks are called by Strava/Plaid's own servers, not your
// browser -- they can't log in with a password, so these stay unauthenticated.
// They're protected instead by Strava's verify_token / Plaid's signed JWT.
app.use('/strava', stravaRouter);
app.use('/plaid', plaidRouter);

// Everything below this line requires the password.
app.use('/api', requireAuth, apiRouter);
app.use('/', requireAuth, express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mileage Ledger running on port ${PORT}`);
  console.log(`Public URL: ${process.env.PUBLIC_URL}`);
});
