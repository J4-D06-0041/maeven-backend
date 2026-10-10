/**
 * One-off: assign every user to the main branch.
 *
 * The login response now carries `branch_id`, and the client preselects that
 * branch at the POS and pins non-admins to it on the cash pages (Opening,
 * Closing, Daily Report, GCash, Prepaid Load, Reports). Until per-user
 * assignment is decided branch by branch, everyone goes under Main Branch.
 *
 * The main branch is the single row with is_main = true; failing that, the
 * single row named "Main Branch"; failing that, the only branch. Anything more
 * ambiguous refuses to run rather than guess.
 *
 * Usage:
 *   node scripts/assignUsersToMainBranch.js            # dry run (default, no writes)
 *   node scripts/assignUsersToMainBranch.js --apply    # actually write
 */
const { pool } = require('../src/db');

async function findMainBranch(client) {
  const { rows: branches } = await client.query(
    'SELECT id, branch_name, is_main FROM branches ORDER BY created_at'
  );
  console.log(`Branches (${branches.length}):`);
  for (const b of branches) console.log(`  ${b.is_main ? '*' : ' '} ${b.branch_name} (${b.id})`);

  const flagged = branches.filter((b) => b.is_main === true);
  if (flagged.length === 1) return flagged[0];
  if (flagged.length > 1) {
    throw new Error(`${flagged.length} branches have is_main = true -- refusing to guess which is Main Branch`);
  }
  const named = branches.filter((b) => String(b.branch_name).trim().toLowerCase() === 'main branch');
  if (named.length === 1) return named[0];
  if (branches.length === 1) return branches[0];
  throw new Error('could not identify a single main branch -- set is_main on it first');
}

async function run() {
  const apply = process.argv.includes('--apply');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const main = await findMainBranch(client);
    console.log(`\nMain branch: ${main.branch_name} (${main.id})\n`);

    const { rows: users } = await client.query(
      `SELECT u.id, u.full_name, u.role, u.branch_id, b.branch_name
         FROM users u LEFT JOIN branches b ON b.id = u.branch_id
        ORDER BY u.role, u.full_name`
    );
    const toChange = users.filter((u) => u.branch_id !== main.id);
    console.log(`Users (${users.length}), ${toChange.length} to change:`);
    for (const u of users) {
      const from = u.branch_name || '(none)';
      const mark = u.branch_id === main.id ? '  unchanged' : `  ${from} -> ${main.branch_name}`;
      console.log(`  ${u.full_name} [${u.role}]${mark}`);
    }

    if (!apply) {
      await client.query('ROLLBACK');
      console.log('\nDry run -- no changes made. Re-run with --apply to write.');
      return;
    }

    const res = await client.query(
      'UPDATE users SET branch_id = $1 WHERE branch_id IS DISTINCT FROM $1',
      [main.id]
    );
    await client.query('COMMIT');
    console.log(`\nAssigned ${res.rowCount} user(s) to ${main.branch_name}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Aborted, no changes made:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
