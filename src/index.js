require('dotenv').config();
// Required before anything else: this validates JWT_SECRET and exits the
// process if it is missing or still set to the old hardcoded default, so a
// misconfigured deployment fails at boot rather than issuing forgeable tokens.
const config = require('./config');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool, connectWithRetry, closePool } = require('./db');

const app = express();

// Trust the proxy Render terminates TLS at, so rate limiting keys on the real
// client IP rather than the load balancer's.
app.set('trust proxy', 1);

// Security headers. Swagger UI needs inline scripts/styles, so CSP is dropped
// for that path only -- and only when the docs are enabled at all.
const helmetDefault = helmet();
const helmetNoCsp = helmet({ contentSecurityPolicy: false });
app.use((req, res, next) => (
  req.path.startsWith('/api-docs') ? helmetNoCsp(req, res, next) : helmetDefault(req, res, next)
));

app.use(express.json());
// Also accept URL-encoded form bodies (e.g., HTML forms or some clients)
app.use(express.urlencoded({ extended: true }));
// CORS configuration: set allowed origins via CORS_ALLOWED_ORIGINS env var
// Example: CORS_ALLOWED_ORIGINS="https://maevencollections.com,https://www.maevencollections.com,*.webcontainer-api.io"
const rawAllowed = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '';
const allowedOrigins = rawAllowed.split(',').map(s => s.trim()).filter(Boolean);

// Simple request logger for debugging origin-related issues
app.use((req, res, next) => {
  const origin = req.headers.origin || '(none)';
  // only log for requests that look cross-origin
  if (origin && origin !== '(none)') {
    console.log(`[CORS] Incoming request origin=${origin} path=${req.path} method=${req.method}`);
  }
  next();
});

// Helper to test if an origin is allowed. Supports exact matches, a single '*' to allow all,
// and wildcard subdomains like '*.webcontainer-api.io'.
//
// The wildcard arm compares parsed hostnames rather than doing `endsWith` on
// the raw origin string: `endsWith('.example.com')` both missed legitimate
// origins carrying a port (`https://app.example.com:8443`) and matched on
// substrings of the scheme+host blob rather than on a real domain boundary.
function isOriginAllowed(origin, allowedList) {
  if (!allowedList || allowedList.length === 0) return false;
  if (!origin) return true; // non-browser clients (curl, server) have no Origin header
  if (allowedList.indexOf('*') !== -1) return true;

  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch (err) {
    return false; // unparseable Origin header
  }

  for (const a of allowedList) {
    if (a === origin) return true;
    if (a.startsWith('*.')) {
      const root = a.slice(2); // `example.com`
      if (hostname === root || hostname.endsWith(`.${root}`)) return true;
    }
  }
  return false;
}

// Default deny. An empty CORS_ALLOWED_ORIGINS used to fall back to
// `{ origin: true, credentials: true }`, which reflects any origin back with
// credentials allowed -- i.e. every site on the internet could make
// authenticated calls on a signed-in user's behalf. A missing config is now a
// closed door, not an open one.
if (allowedOrigins.length === 0) {
  console.warn(
    '[CORS] CORS_ALLOWED_ORIGINS is not set. All cross-origin browser requests ' +
    'will be rejected. Set it to a comma-separated list of allowed origins.'
  );
}

app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin, allowedOrigins)) return callback(null, true);
    console.warn(`[CORS] Rejected origin=${origin}`);
    return callback(new Error('CORS policy: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.options('*', cors());
app.use(morgan('dev'));

// Rate limiting. The login bucket is deliberately tight: it is the one
// unauthenticated endpoint, so it is where credential stuffing lands.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, error: 'too many login attempts, try again later' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'too many requests, slow down' },
});

app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

// API routes
const apiRouter = require('./routes/api');
app.use('/api', apiRouter);
// Auth routes (login)
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

// Swagger / OpenAPI UI -- only mounted when explicitly enabled. Publishing a
// full description of every endpoint to anonymous callers is free
// reconnaissance, so it stays off unless EXPOSE_API_DOCS=true.
const path = require('path');
if (config.exposeApiDocs) {
const swaggerUi = require('swagger-ui-express');
const openapi = require('./openapi.json');
// Allow overriding the OpenAPI server URL via environment variables so
// the examples in the Swagger UI call the deployed API instead of
// `http://localhost:3000`.
const openapiServerFromEnv = process.env.OPENAPI_SERVER || process.env.BASE_URL || process.env.API_BASE_URL;
if (openapiServerFromEnv) {
  const normalized = String(openapiServerFromEnv).replace(/\/+$/g, '');
  openapi.servers = [{ url: normalized }];
}
// Let `swagger-ui-express` serve the Swagger UI HTML and assets.
// Configure Swagger UI to fetch the live OpenAPI JSON from the API
// (so edits to `src/openapi.json` are reflected without rebuilding the UI bundle).
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(null, { swaggerUrl: '/api/openapi.json' }));

// Some swagger-ui-dist releases name the main stylesheet `index.css` while
// the generated HTML references `swagger-ui.css`. Add explicit mappings
// so requests for `swagger-ui.css` and favicons are served correctly.
try {
  const swaggerUiDist = require('swagger-ui-dist');
  const swaggerUiAssetPath = swaggerUiDist.getAbsoluteFSPath();
  app.get('/api-docs/swagger-ui.css', (req, res) => {
    res.type('text/css; charset=UTF-8');
    return res.sendFile(path.join(swaggerUiAssetPath, 'index.css'));
  });
  app.get('/api-docs/favicon-32x32.png', (req, res) => {
    return res.sendFile(path.join(swaggerUiAssetPath, 'favicon-32x32.png'));
  });
  app.get('/api-docs/favicon-16x16.png', (req, res) => {
    return res.sendFile(path.join(swaggerUiAssetPath, 'favicon-16x16.png'));
  });
} catch (err) {
  // ignore if swagger-ui-dist is not installed
}
} else {
  console.log('[docs] API docs disabled. Set EXPOSE_API_DOCS=true to enable /api-docs.');
}

app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW()');
    return res.json({ ok: true, time: rows[0].now });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Unknown routes get JSON, not Express's HTML default.
app.use((req, res) => res.status(404).json({ ok: false, error: 'not found' }));

// Central error handler. Without one, Express's default handler answered a
// rejected CORS request (and any thrown error) with an HTML stack trace,
// leaking file paths and library versions. Errors are logged in full here and
// summarized to the caller.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const isCorsRejection = /CORS policy/i.test((err && err.message) || '');
  const status = isCorsRejection ? 403 : (err && err.status) || 500;

  console.error('[error]', req.method, req.originalUrl, '->', status, (err && err.stack) || err);

  return res.status(status).json({
    ok: false,
    error: isCorsRejection ? 'origin not allowed' : 'internal server error',
  });
});

const port = process.env.PORT || 3000;

let server;

async function start() {
  try {
    await connectWithRetry({ retries: 5, initialDelay: 2000 });
    server = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to start server due to DB error. Exiting.');
    process.exit(1);
  }
}

function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down.`);
  if (server) {
    server.close(async (err) => {
      if (err) console.error('Error closing server:', err);
      await closePool();
      process.exit(err ? 1 : 0);
    });
    // force exit in 10s
    setTimeout(() => {
      console.error('Forcing shutdown');
      process.exit(1);
    }, 10000).unref();
  } else {
    closePool().then(() => process.exit(0));
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  shutdown('uncaughtException');
});

start();
