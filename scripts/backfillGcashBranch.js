/**
 * One-off backfill: every gcash_transactions row currently has branch_id =
 * NULL, which means `WHERE gt.branch_id = $1` in getSalesTotals
 * (src/models/cashReconciliations.js) silently drops all of them -- GCash has
 * never been counted in any cash reconciliation.
 *
 * This assigns the single main branch to every branchless GCash row, and to
 * any user missing a branch (the form defaults branch_id from
 * user.branch_id, so a branchless user is how these rows got created).
 *
 * Refuses to run if more than one branch exists -- with two branches,
 * guessing which one a branchless transaction belongs to would misattribute
 * cash between registers instead of fixing the record. Deliberately does NOT
 * touch cash_reconciliations: closed days keep the figures that were signed
 * off on. See docs/cash-and-services-rules.md and the plan this came from
 * for the full writeup.
 */
const { pool } = require('../src/db');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const branchesRes = await client.query('SELECT id, branch_name FROM branches');
    if (branchesRes.rows.length !== 1) {
      throw new Error(
        `expected exactly 1 branch, found ${branchesRes.rows.length} -- ` +
        `refusing to guess which branch owns the branchless GCash rows`
      );
    }
    const branchId = branchesRes.rows[0].id;
    const branchName = branchesRes.rows[0].branch_name;

    const gcashRes = await client.query(
      `UPDATE gcash_transactions SET branch_id = $1 WHERE branch_id IS NULL`,
      [branchId]
    );

    const usersRes = await client.query(
      `UPDATE users SET branch_id = $1 WHERE branch_id IS NULL`,
      [branchId]
    );

    await client.query('COMMIT');
    console.log(`Assigned branch "${branchName}" (${branchId}) to:`);
    console.log(`  ${gcashRes.rowCount} gcash_transactions row(s)`);
    console.log(`  ${usersRes.rowCount} user(s)`);
    console.log('cash_reconciliations was NOT touched -- closed days keep their signed-off figures.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Backfill aborted, no changes made:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
