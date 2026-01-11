require('dotenv').config();
const { Pool } = require('pg');

// Support either individual DB_* env vars or a single connection string (DATABASE_URL / DB_URL).
const connectionString = process.env.DATABASE_URL || process.env.DB_URL || null;

// Determine whether to enable SSL. You can explicitly control with DB_SSL=true|false.
// If a connection string contains `sslmode=require` we'll also enable SSL by default.
const connectionStringSuggestsSSL = connectionString && /sslmode=require/i.test(connectionString);
const sslEnv = typeof process.env.DB_SSL !== 'undefined' ? process.env.DB_SSL === 'true' || process.env.DB_SSL === '1' : undefined;
const sslEnabled = sslEnv === undefined ? Boolean(connectionStringSuggestsSSL) : sslEnv;

const ssl = sslEnabled ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' } : undefined;

const poolConfig = connectionString
  ? { connectionString }
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
    };

poolConfig.max = poolConfig.max || 10;
poolConfig.idleTimeoutMillis = poolConfig.idleTimeoutMillis || 30000;
if (ssl) poolConfig.ssl = ssl;

const pool = new Pool(poolConfig);

async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('Postgres connected:', res.rows[0].now);
    return res.rows[0].now;
  } catch (err) {
    console.error('Postgres connection error:', err.message || err);
    throw err;
  }
}

async function connectWithRetry(options = {}) {
  const { retries = 5, initialDelay = 2000 } = options;
  let attempt = 0;
  let delay = initialDelay;

  while (attempt < retries) {
    try {
      attempt += 1;
      console.log(`DB connect attempt ${attempt}/${retries}`);
      await testConnection();
      return;
    } catch (err) {
      if (attempt >= retries) {
        console.error('Exceeded maximum DB connection attempts');
        throw err;
      }
      console.warn(`DB connection failed, retrying in ${delay}ms...`);
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2; // exponential backoff
    }
  }
}

async function closePool() {
  try {
    await pool.end();
    console.log('Postgres pool has ended');
  } catch (err) {
    console.error('Error while closing Postgres pool:', err.message || err);
  }
}

module.exports = { pool, testConnection, connectWithRetry, closePool };
