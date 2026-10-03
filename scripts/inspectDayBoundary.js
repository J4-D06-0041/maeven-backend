/**
 * Read-only diagnostic: for one business date, list the cash-relevant rows
 * that the OLD day filter (database-session midnight) and the NEW filter
 * (Manila midnight) disagree about -- i.e. the transactions that moved into
 * or out of that day.
 *
 * Usage:  node scripts/inspectDayBoundary.js 2026-09-08
 */
const { pool } = require('../src/db');
const { dayRange } = require('../src/utils/businessDay');

async function run() {
  const date = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    console.error('Usage: node scripts/inspectDayBoundary.js YYYY-MM-DD');
    process.exitCode = 1;
    return;
  }

  const old = (col) => `(${col} >= $1::date AND ${col} < ($1::date + INTERVAL '1 day'))`;
  const ts = (col) => `${col}::text AS raw_timestamp, (${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::text AS manila_if_utc`;

  const queries = {
    'cash payments': `
      SELECT o.order_number, p.amount, ${ts('p.payment_date')},
             ${old('p.payment_date')} AS in_old, ${dayRange('p.payment_date', '$1', '$1', { naive: true })} AS in_new
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.payment_method = 'cash' AND o.order_status NOT IN ('cancelled')
        AND p.payment_date >= ($1::date - 1) AND p.payment_date < ($1::date + 2)
        AND ${old('p.payment_date')} <> (${dayRange('p.payment_date', '$1', '$1', { naive: true })})`,
    'gcash': `
      SELECT gt.reference_number, gt.service_type, gt.principal_amount, gt.gross_amount, gt.cash_impact,
             gt.created_at::text AS raw_timestamp, (gt.created_at AT TIME ZONE 'Asia/Manila')::text AS manila_time,
             ${old('gt.created_at')} AS in_old, ${dayRange('gt.created_at', '$1', '$1')} AS in_new
      FROM gcash_transactions gt
      WHERE gt.created_at >= ($1::date - 1) AND gt.created_at < ($1::date + 2)
        AND ${old('gt.created_at')} <> (${dayRange('gt.created_at', '$1', '$1')})`,
    'prepaid load': `
      SELECT pt.reference_number, pt.gross_amount, pt.cash_impact,
             pt.created_at::text AS raw_timestamp, (pt.created_at AT TIME ZONE 'Asia/Manila')::text AS manila_time,
             ${old('pt.created_at')} AS in_old, ${dayRange('pt.created_at', '$1', '$1')} AS in_new
      FROM prepaid_load_transactions pt
      WHERE pt.created_at >= ($1::date - 1) AND pt.created_at < ($1::date + 2)
        AND ${old('pt.created_at')} <> (${dayRange('pt.created_at', '$1', '$1')})`,
  };

  const { rows: tz } = await pool.query(`SELECT current_setting('TimeZone') AS session_tz`);
  console.log(`Database session time zone: ${tz[0].session_tz}`);
  console.log(`Rows that moved for ${date} (in_old != in_new):\n`);

  for (const [label, sql] of Object.entries(queries)) {
    const { rows } = await pool.query(sql, [date]);
    console.log(`== ${label}: ${rows.length} row(s)`);
    if (rows.length) console.table(rows);
  }
}

run()
  .catch((err) => { console.error('Inspect failed:', err.message || err); process.exitCode = 1; })
  .finally(() => pool.end());
