require('dotenv').config();
const express = require('express');
const path = require('path');

const { router: stravaRouter } = require('./routes/strava');
const { router: plaidRouter } = require('./routes/plaid');
const apiRouter = require('./routes/api');

const app = express();

// Strava/Plaid webhooks send JSON bodies -- parse for all routes except
// Plaid's webhook, which applies its own json() middleware inline
// (kept identical here for simplicity; express.json() is idempotent-safe).
app.use(express.json());

app.use('/strava', stravaRouter);
app.use('/plaid', plaidRouter);
app.use('/api', apiRouter);

// Serves the basic frontend (public/index.html + assets)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mileage Ledger running on port ${PORT}`);
  console.log(`Public URL: ${process.env.PUBLIC_URL}`);
});
