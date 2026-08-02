const { pool } = require('../src/db');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE gcash_transactions
      SET cash_impact = -ABS(principal_amount)
      WHERE service_type = 'cash_out'
        AND cash_impact <> -ABS(principal_amount)
    `);
    await client.query('COMMIT');
    console.log(`Updated ${result.rowCount} cash-out transaction(s) to exclude fee from cash_impact`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating cash_impact:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
