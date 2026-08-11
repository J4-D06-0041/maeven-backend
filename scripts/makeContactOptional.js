const { pool, closePool } = require('../src/db');

// Customers and suppliers previously required a phone number (email was
// already optional). Both should be optional on create going forward.
async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;');
    await client.query('ALTER TABLE suppliers ALTER COLUMN phone DROP NOT NULL;');
    await client.query('COMMIT');
    console.log('customers.phone and suppliers.phone are now nullable');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error relaxing phone constraints:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await closePool();
  }
}

run();
