const { Pool } = require('pg');

// Uses same env vars as project (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT)
const pool = new Pool();

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;");
    await client.query("ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('draft','estimated','ordered','received','cancelled'));");
    await client.query('COMMIT');
    console.log('Constraint updated successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating constraint:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
