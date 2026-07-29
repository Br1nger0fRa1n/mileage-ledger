const { Pool } = require('pg');

// Railway injects DATABASE_URL automatically once Postgres is attached.
// Railway's internal Postgres doesn't need SSL; a lot of hosted Postgres
// providers do -- if you ever move providers and get SSL errors, add:
//   ssl: { rejectUnauthorized: false }
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres error on idle client', err);
});

module.exports = { pool };
