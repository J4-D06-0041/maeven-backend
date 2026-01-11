require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const { pool, connectWithRetry, closePool } = require('./db');

const app = express();
app.use(express.json());
app.use(morgan('dev'));

// API routes
const apiRouter = require('./routes/api');
app.use('/api', apiRouter);

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
