/**
 * Read-only diagnostic: for closed reconciliation day(s), compare each
 * component frozen at close against what the live data produces now, to show
 * WHICH component changed (cash sales, GCash/prepaid net impact, expenses,
 * opening cash).
 *
 * Usage:  node scripts/compareClosedDay.js 2026-09-08 [2026-09-14 ...]
 */
const { pool } = require('../src/db');
const cashReconciliationsModel = require('../src/models/cashReconciliations');

const money = (v) => Number(Number(v || 0).toFixed(2));

async function run() {
  const dates = process.argv.slice(2);
  if (!dates.length || dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    console.error('Usage: node scripts/compareClosedDay.js YYYY-MM-DD [YYYY-MM-DD ...]');
    process.exitCode = 1;
    return;
  }

  for (const date of dates) {
    const { rows } = await pool.query(
      `SELECT * FROM cash_reconciliations WHERE business_date = $1::date AND closed_at IS NOT NULL`,
      [date]
    );
    console.log(`\n=== ${date}: ${rows.length} closed record(s)`);
    for (const row of rows) {
      const live = await cashReconciliationsModel.previewClose(row.id);
      const fields = [
        ['opening_cash_total', row.opening_cash_total, live.opening_cash_total],
        ['cash_sales_amount', row.cash_sales_amount, live.cash_sales_amount],
        ['other_cash_impact_amount', row.other_cash_impact_amount, live.other_cash_impact_amount],
        ['gcash_cash_in_total', row.gcash_cash_in_total, live.gcash_cash_in_total],
        ['gcash_cash_out_total', row.gcash_cash_out_total, live.gcash_cash_out_total],
        ['total_expenses_amount', row.total_expenses_amount, live.total_expenses_amount],
        ['expected_cash_on_hand', row.expected_cash_on_hand, live.expected_cash_on_hand],
      ].map(([field, stored, now]) => ({
        field,
        stored_at_close: money(stored),
        live_now: money(now),
        difference: money(now - stored),
        changed: money(now - stored) !== 0 ? '<<<' : '',
      }));
      console.log(`branch ${row.branch_id}, closed_at ${row.closed_at.toISOString()}`);
      console.table(fields);
    }
  }
}

run()
  .catch((err) => { console.error('Compare failed:', err.message || err); process.exitCode = 1; })
  .finally(() => pool.end());
