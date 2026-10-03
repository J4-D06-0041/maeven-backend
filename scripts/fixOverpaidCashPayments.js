/**
 * One-off data fix: the POS used to save the cash TENDERED as the payment
 * amount, so a ₱850 sale paid with ₱1,000 recorded a ₱1,000 cash payment.
 * That overstated cash_sales_amount (and expected cash) by the change given.
 *
 * For orders that have exactly ONE payment and whose payment amount exceeds
 * the order total, this caps the payment at the order total. Orders with
 * several payments that together exceed the total are only listed -- which
 * payment carried the change can't be decided automatically.
 *
 * After applying, run scripts/restateClosedReconciliations.js to restate the
 * closed days.
 *
 * Usage:
 *   node scripts/fixOverpaidCashPayments.js           # dry run (default, no writes)
 *   node scripts/fixOverpaidCashPayments.js --apply   # write (single transaction)
 */
const { pool } = require('../src/db');

async function run() {
  const apply = process.argv.includes('--apply');

  const { rows } = await pool.query(`
    SELECT o.id AS order_id, o.order_number, o.total_amount,
           count(p.id) AS payment_count,
           sum(p.amount) AS paid,
           min(p.id::text) AS payment_id,
           min(p.payment_method) AS payment_method
    FROM orders o
    JOIN payments p ON p.order_id = o.id
    WHERE o.order_status NOT IN ('cancelled')
    GROUP BY o.id
    HAVING sum(p.amount) > o.total_amount
    ORDER BY o.created_at
  `);

  const single = rows.filter((r) => Number(r.payment_count) === 1);
  const multi = rows.filter((r) => Number(r.payment_count) > 1);
  let excess = 0;
  single.forEach((r) => {
    excess += Number(r.paid) - Number(r.total_amount);
    console.log(`${r.order_number}: ${r.payment_method} ${r.paid} -> ${r.total_amount}`);
  });
  console.log(`\n${single.length} single-payment order(s) overstated by ${excess.toFixed(2)} in total.`);
  if (multi.length) {
    console.log(`${multi.length} multi-payment order(s) need manual review:`);
    multi.forEach((r) => console.log(`  ${r.order_number}: paid ${r.paid} vs total ${r.total_amount}`));
  }

  if (!apply) {
    console.log('Dry run only -- re-run with --apply to write changes.');
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of single) {
      await client.query('UPDATE payments SET amount = $2 WHERE id = $1', [r.payment_id, r.total_amount]);
    }
    await client.query('COMMIT');
    console.log(`${single.length} payment(s) corrected.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

run()
  .catch((err) => { console.error('Fix failed:', err.message || err); process.exitCode = 1; })
  .finally(() => pool.end());
