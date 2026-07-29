require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema.sql ...');
  await pool.query(schema);
  console.log('Done. Tables ready: activities, transactions, plaid_items, strava_tokens');
  await pool.end();
}

main().catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
