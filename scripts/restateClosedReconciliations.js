/**
 * One-off restatement: recompute expected_cash_on_hand, variance_amount, and
 * is_short for every CLOSED cash_reconciliations record, using the current
 * getSalesTotals/computeExpectedCash logic (the same one closeDay uses today,
 * via cashReconciliationsModel.previewClose).
 *
 * Corrects two historical gaps that predate the 2026-08-15 fixes:
 *   - GCash transactions were excluded from every reconciliation because
 *     gcash_transactions.branch_id was NULL on all of them (fixed by
 *     scripts/backfillGcashBranch.js, run beforehand).
 *   - Cash expenses were never subtracted from expected cash on hand.
 *
 * actual_cash_on_hand and closing_cash_breakdown are NEVER touched -- they
 * are a physical fact of what was counted that day and do not change. Only
 * the *expected* side and its derived variance/is_short are recomputed.
 *
 * The original figures are preserved in the `notes` field, appended, so the
 * restatement is visible rather than silent.
 *
 * Usage:
 *   node scripts/restateClosedReconciliations.js            # dry run (default, no writes)
 *   node scripts/restateClosedReconciliations.js --apply     # actually write
 */
const { pool } = require('../src/db');
const cashReconciliationsModel = require('../src/models/cashReconciliations');

function toMoney(n) {
  return Number(Number(n || 0).toFixed(2));
}


async function run() {
  const apply = process.argv.includes('--apply');

  // business_date is cast to text in the query itself -- letting node-postgres
  // parse a DATE column into a JS Date and then calling toISOString() shifts
  // the printed date by a day in any timezone behind UTC. Casting avoids that
  // entirely rather than trying to format the Date correctly.
  const { rows } = await pool.query(`
    SELECT id, business_date::text AS business_date, branch_id, opening_cash_total,
           actual_cash_on_hand, expected_cash_on_hand, variance_amount, is_short, notes
    FROM cash_reconciliations
    WHERE closed_at IS NOT NULL
    ORDER BY business_date
  `);

  let changed = 0;
  const restatedOn = new Date().toISOString().slice(0, 10);

  for (const row of rows) {
    const totals = await cashReconciliationsModel.previewClose(row.id);
    const newExpected = toMoney(totals.expected_cash_on_hand);
    const oldExpected = toMoney(row.expected_cash_on_hand);
    const delta = Math.abs(toMoney(newExpected - oldExpected));

    if (delta < 0.01) continue; // unaffected by either bug, leave untouched

    const actual = toMoney(row.actual_cash_on_hand);
    const newVariance = toMoney(actual - newExpected);
    const newIsShort = newVariance < 0;
    const oldVariance = toMoney(row.variance_amount);

    changed++;
    console.log(
      `${row.business_date}: expected ${oldExpected} -> ${newExpected}, ` +
      `variance ${oldVariance} -> ${newVariance}, is_short ${row.is_short} -> ${newIsShort}`
    );

    if (apply) {
      const restatementNote =
        `[Restated ${restatedOn}] Original: expected ${oldExpected}, actual ${actual}, ` +
        `variance ${oldVariance}, is_short=${row.is_short}. Cause: GCash transactions were ` +
        `excluded from this calculation because gcash_transactions.branch_id was NULL ` +
        `(fixed 2026-08-15); cash expenses were not previously subtracted from expected ` +
        `cash on hand. Actual counted cash (${actual}) is unchanged -- only the expected ` +
        `figure and its derived variance were recomputed.`;
      const combinedNotes = row.notes ? `${row.notes}\n\n${restatementNote}` : restatementNote;

      await pool.query(
        `UPDATE cash_reconciliations SET
           cash_sales_amount = $2,
           other_cash_impact_amount = $3,
           gcash_cash_in_total = $4,
           gcash_cash_out_total = $5,
           total_expenses_amount = $6,
           total_sales_amount = $7,
           expected_cash_on_hand = $8,
           variance_amount = $9,
           is_short = $10,
           notes = $11,
           updated_at = now()
         WHERE id = $1`,
        [
          row.id,
          totals.cash_sales_amount,
          totals.other_cash_impact_amount,
          totals.gcash_cash_in_total,
          totals.gcash_cash_out_total,
          totals.total_expenses_amount,
          totals.total_sales_amount,
          newExpected,
          newVariance,
          newIsShort,
          combinedNotes,
        ]
      );
    }
  }

  console.log(`\n${changed} of ${rows.length} closed reconciliation(s) ${apply ? 'restated' : 'would be restated'}.`);
  if (!apply) console.log('Dry run only -- re-run with --apply to write changes.');
  await pool.end();
}

run().catch(async (err) => {
  console.error('Restatement failed:', err.message || err);
  try { await pool.end(); } catch (e) {}
  process.exit(1);
});
