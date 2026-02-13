const jwt = require('jsonwebtoken');

// Lightweight middleware to decode JWT if present and attach `req.user`.
// Does not reject requests; it only sets `req.user` when a valid token is provided.
module.exports = function authMiddleware(req, res, next) {
  try {
    const auth = req.headers && req.headers.authorization;
    if (!auth) {
      if (process.env.AUTH_DEBUG) console.debug('[auth] no Authorization header');
      return next();
    }
    const parts = String(auth).split(' ');
    if (parts.length !== 2) {
      if (process.env.AUTH_DEBUG) console.debug('[auth] Authorization header malformed:', auth);
      return next();
    }
    const scheme = parts[0];
    const token = parts[1];
    if (!/^Bearer$/i.test(scheme)) {
      if (process.env.AUTH_DEBUG) console.debug('[auth] Authorization scheme is not Bearer:', scheme);
      return next();
    }

    const jwtSecret = process.env.JWT_SECRET || 'please-change-this-secret';
    try {
      const decoded = jwt.verify(token, jwtSecret);
      // Attach minimal user info
      req.user = { id: decoded.id, role: decoded.role };
      if (process.env.AUTH_DEBUG) console.debug('[auth] token verified, user id=', decoded.id);
    } catch (err) {
      if (process.env.AUTH_DEBUG) console.debug('[auth] token verification failed:', err && err.message);
      // Ignore invalid token and continue without user
    }
    return next();
  } catch (err) {
    return next();
  }
};

// Middleware to require authentication (returns 401 if no valid user)
module.exports.requireAuth = function requireAuth(req, res, next) {
  if (req.user && req.user.id) return next();
  return res.status(401).json({ ok: false, error: 'authentication required' });
};
