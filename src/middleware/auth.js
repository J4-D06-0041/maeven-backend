const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config');

// Decodes the JWT if one is present and attaches `req.user`.
//
// This pass does not reject requests — `requireAuth` / `requireRole` do that —
// but it records *why* a token was unusable in `req.authError` so the guards can
// tell "no credentials" apart from "expired credentials" when they respond.
module.exports = function authMiddleware(req, res, next) {
  try {
    const header = req.headers && req.headers.authorization;
    if (!header) {
      if (process.env.AUTH_DEBUG) console.debug('[auth] no Authorization header');
      return next();
    }

    const parts = String(header).split(' ');
    if (parts.length !== 2) {
      if (process.env.AUTH_DEBUG) console.debug('[auth] Authorization header malformed');
      req.authError = 'malformed';
      return next();
    }

    const [scheme, token] = parts;
    if (!/^Bearer$/i.test(scheme)) {
      if (process.env.AUTH_DEBUG) console.debug('[auth] Authorization scheme is not Bearer:', scheme);
      req.authError = 'malformed';
      return next();
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      req.user = { id: decoded.id, role: decoded.role };
      if (process.env.AUTH_DEBUG) console.debug('[auth] token verified, user id=', decoded.id);
    } catch (err) {
      if (process.env.AUTH_DEBUG) console.debug('[auth] token verification failed:', err && err.message);
      req.authError = err && err.name === 'TokenExpiredError' ? 'expired' : 'invalid';
    }

    return next();
  } catch (err) {
    req.authError = 'invalid';
    return next();
  }
};

// Requires a valid, non-expired token.
function requireAuth(req, res, next) {
  if (req.user && req.user.id) return next();

  const error = req.authError === 'expired'
    ? 'session expired'
    : 'authentication required';

  return res.status(401).json({ ok: false, error });
}

// Requires a valid token whose role is in `roles`.
//
// Always layered on top of `requireAuth` so an unauthenticated caller gets a 401
// (retry after signing in) rather than a 403 (signed in, but not permitted).
function requireRole(...roles) {
  const allowed = roles.flat();

  return function roleGuard(req, res, next) {
    if (!req.user || !req.user.id) return requireAuth(req, res, next);
    if (allowed.includes(req.user.role)) return next();

    return res.status(403).json({
      ok: false,
      error: 'insufficient permissions for this action',
    });
  };
}

module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;
module.exports.requireAdmin = requireRole('admin');
