/**
 * Read-only diagnostic: every payment on a business date, with its order's
 * status and timestamps, to trace a payment that appeared after close.
 *
 * Usage:  node scripts/listDayCashPayments.js 2026-09-08
 */
const { pool } = require('../src/db');
const { dayRange } = require('../src/utils/businessDay');

async function run() {
  const date = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    console.error('Usage: node scripts/listDayCashPayments.js YYYY-MM-DD');
    process.exitCode = 1;
    return;
  }
  const { rows } = await pool.query(`
    SELECT p.id AS payment_id, o.order_number, p.payment_method, p.amount,
           p.payment_date::text AS payment_date, o.created_at::text AS order_created_at,
           o.order_status, o.total_amount
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE ${dayRange('p.payment_date', '$1', '$1', { naive: true })}
    ORDER BY p.payment_date`, [date]);
  console.log(`${rows.length} payment(s) on ${date} (Manila day):`);
  console.table(rows);
}

run()
  .catch((err) => { console.error('List failed:', err.message || err); process.exitCode = 1; })
  .finally(() => pool.end());
