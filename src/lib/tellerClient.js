const https = require('https');
const axios = require('axios');

// Teller's cert/key are stored as env vars containing the full PEM content.
// Some hosting UIs mangle literal newlines into "\n" escape sequences when
// pasted -- this restores real newlines either way.
function normalizePem(value) {
  if (!value) return value;
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

// mTLS is required for all Development/Production API calls (not Sandbox).
// If cert/key aren't set, requests will simply fail -- fine for Sandbox-only testing.
const httpsAgent = new https.Agent({
  cert: normalizePem(process.env.TELLER_CERT),
  key: normalizePem(process.env.TELLER_KEY),
});

/**
 * Returns an axios instance authenticated for a specific access token.
 * Teller uses HTTP Basic Auth where the access_token is the username and
 * the password is left blank.
 */
function tellerClientFor(accessToken) {
  return axios.create({
    baseURL: 'https://api.teller.io',
    httpsAgent,
    auth: { username: accessToken, password: '' },
  });
}

module.exports = { tellerClientFor };
