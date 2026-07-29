const session = require('express-session');

// Single shared password for this single-user app. Session cookie is how
// the browser stays "logged in" across requests.
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  },
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();

  // For API calls, return JSON so the frontend can redirect itself.
  if (req.path.startsWith('/api')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login.html');
}

module.exports = { sessionMiddleware, requireAuth };
