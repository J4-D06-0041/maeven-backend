require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const { pool, connectWithRetry, closePool } = require('./db');

const app = express();
app.use(express.json());
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
function isOriginAllowed(origin, allowedList) {
  if (!allowedList || allowedList.length === 0) return false;
  if (!origin) return true; // non-browser clients (curl, server) have no Origin header
  if (allowedList.indexOf('*') !== -1) return true;
  for (const a of allowedList) {
    if (a === origin) return true;
    if (a.startsWith('*.')) {
      const root = a.slice(1); // `.example.com`
      if (origin.endsWith(root)) return true;
    }
  }
  return false;
}

if (allowedOrigins.length === 0) {
  // No origins configured: enable permissive CORS (useful for local/dev).
  // In production, set `CORS_ALLOWED_ORIGINS` to a comma-separated list of allowed origins.
  app.use(cors({ origin: true, credentials: true }));
} else {
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
}
app.use(morgan('dev'));

// API routes
const apiRouter = require('./routes/api');
app.use('/api', apiRouter);
// Auth routes (login)
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

// Swagger / OpenAPI UI
const swaggerUi = require('swagger-ui-express');
const openapi = require('./openapi.json');
const path = require('path');
// Serve swagger-ui static assets directly (ensure correct MIME types on some hosts)
try {
  const swaggerUiDist = require('swagger-ui-dist');
  const swaggerUiAssetPath = swaggerUiDist.getAbsoluteFSPath();
  // Prevent the static `index.html` from swagger-ui-dist being served
  // (it contains the default Petstore UI). Let `swagger-ui-express`
  // render the HTML while we only serve the static assets (JS/CSS).
  app.use('/api-docs', express.static(swaggerUiAssetPath, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=UTF-8');
    }
  }));
} catch (err) {
  // if swagger-ui-dist is not available, fall back to swagger-ui-express assets
}

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));

app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW()');
    return res.json({ ok: true, time: rows[0].now });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
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
