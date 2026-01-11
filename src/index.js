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
