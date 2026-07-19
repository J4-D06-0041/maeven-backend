const { pool } = require('../db');

function toMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function resolveBusinessDate(value) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return String(value);
  }
  return new Date().toISOString().slice(0, 10);
}

function requireText(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(`${fieldName} is required`);
  }
  return text;
}

const SELECT_FIELDS = `
  bd.*,
  b.branch_name,
  u.full_name AS deposited_by_name,
  ru.full_name AS reversed_by_name,
  ro.reference_number AS reversal_of_reference_number
`;

async function findByIdWithClient(client, id) {
  const sql = `
    SELECT
      ${SELECT_FIELDS}
    FROM bank_deposits bd
    LEFT JOIN branches b ON b.id = bd.branch_id
    LEFT JOIN users u ON u.id = bd.deposited_by
    LEFT JOIN users ru ON ru.id = bd.reversed_by
    LEFT JOIN bank_deposits ro ON ro.id = bd.reversal_of_id
    WHERE bd.id = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [id]);
  return rows[0] || null;
}

async function create({
  branch_id,
  cash_reconciliation_id,
  business_date,
  amount,
  bank_account,
  reference_number,
  depositor_name,
  photo_proof_url,
  notes,
  deposited_by,
  deposited_at,
}) {
  const depositAmount = toMoney(amount);
  if (depositAmount <= 0) {
    throw new Error('amount must be greater than 0');
  }

  const bankAccount = requireText(bank_account, 'bank_account');
  const referenceNumber = requireText(reference_number, 'reference_number');
  const depositorName = requireText(depositor_name, 'depositor_name');
  const photoProofUrl = requireText(photo_proof_url, 'photo_proof_url');

  let finalBranchId = branch_id || null;
  let finalBusinessDate = resolveBusinessDate(business_date);

  if (cash_reconciliation_id) {
    const reconciliationRes = await pool.query(
      'SELECT id, branch_id, business_date FROM cash_reconciliations WHERE id = $1',
      [cash_reconciliation_id]
    );
    const reconciliation = reconciliationRes.rows[0];
    if (!reconciliation) {
      throw new Error('cash reconciliation not found');
    }

    finalBranchId = reconciliation.branch_id;
    finalBusinessDate = String(reconciliation.business_date).slice(0, 10);

    if (branch_id && branch_id !== finalBranchId) {
      throw new Error('branch_id does not match the reconciliation branch');
    }
  }

  if (!finalBranchId) {
    throw new Error('branch_id is required');
  }

  const sql = `
    INSERT INTO bank_deposits (
      branch_id,
      cash_reconciliation_id,
      business_date,
      amount,
      bank_account,
      reference_number,
      depositor_name,
      photo_proof_url,
      status,
      notes,
      deposited_by,
      deposited_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, 'posted', $9, $10, COALESCE($11::timestamptz, now()), now(), now())
    RETURNING *
  `;

  try {
    const { rows } = await pool.query(sql, [
      finalBranchId,
      cash_reconciliation_id || null,
      finalBusinessDate,
      depositAmount,
      bankAccount,
      referenceNumber,
      depositorName,
      photoProofUrl,
      notes || null,
      deposited_by || null,
      deposited_at || null,
    ]);

    return findById(rows[0].id);
  } catch (err) {
    if (String(err.message || '').includes('ux_bank_deposits_reference_number')) {
      throw new Error('reference_number must be unique');
    }
    throw err;
  }
}

async function findById(id) {
  return findByIdWithClient(pool, id);
}

async function list({
  limit = 100,
  offset = 0,
  branch_id,
  business_date,
  from,
  to,
  cash_reconciliation_id,
} = {}) {
  const params = [];
  const where = [];

  if (branch_id) {
    params.push(branch_id);
    where.push(`bd.branch_id = $${params.length}`);
  }

  if (business_date) {
    params.push(business_date);
    where.push(`bd.business_date = $${params.length}::date`);
  }

  if (from) {
    params.push(from);
    where.push(`bd.business_date >= $${params.length}::date`);
  }

  if (to) {
    params.push(to);
    where.push(`bd.business_date <= $${params.length}::date`);
  }

  if (cash_reconciliation_id) {
    params.push(cash_reconciliation_id);
    where.push(`bd.cash_reconciliation_id = $${params.length}`);
  }

  params.push(Number(limit) || 100);
  params.push(Number(offset) || 0);

  const sql = `
    SELECT
      ${SELECT_FIELDS}
    FROM bank_deposits bd
    LEFT JOIN branches b ON b.id = bd.branch_id
    LEFT JOIN users u ON u.id = bd.deposited_by
    LEFT JOIN users ru ON ru.id = bd.reversed_by
    LEFT JOIN bank_deposits ro ON ro.id = bd.reversal_of_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY bd.deposited_at DESC, bd.created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function reverse({
  id,
  reversal_reason,
  reference_number,
  depositor_name,
  photo_proof_url,
  notes,
  deposited_by,
  deposited_at,
}) {
  const reason = requireText(reversal_reason, 'reversal_reason');
  const reversalReference = requireText(reference_number, 'reference_number');
  const reversalDepositorName = requireText(depositor_name, 'depositor_name');
  const reversalProof = requireText(photo_proof_url, 'photo_proof_url');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const originalRes = await client.query('SELECT * FROM bank_deposits WHERE id = $1 FOR UPDATE', [id]);
    const original = originalRes.rows[0];
    if (!original) {
      throw new Error('bank deposit not found');
    }

    if (original.reversal_of_id) {
      throw new Error('cannot reverse a reversal entry');
    }

    if (original.status === 'reversed') {
      throw new Error('bank deposit is already reversed');
    }

    const existingReversalRes = await client.query(
      'SELECT id FROM bank_deposits WHERE reversal_of_id = $1 LIMIT 1',
      [id]
    );
    if (existingReversalRes.rows[0]) {
      throw new Error('bank deposit is already reversed');
    }

    const reversalAmount = toMoney(-Math.abs(Number(original.amount || 0)));

    const insertSql = `
      INSERT INTO bank_deposits (
        branch_id,
        cash_reconciliation_id,
        business_date,
        amount,
        bank_account,
        reference_number,
        depositor_name,
        photo_proof_url,
        status,
        reversal_of_id,
        reversal_reason,
        notes,
        deposited_by,
        deposited_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3::date,
        $4,
        $5,
        $6,
        $7,
        $8,
        'reversed',
        $9,
        $10,
        $11,
        $12,
        COALESCE($13::timestamptz, now()),
        now(),
        now()
      )
      RETURNING id
    `;

    const reversalRes = await client.query(insertSql, [
      original.branch_id,
      original.cash_reconciliation_id,
      resolveBusinessDate(original.business_date),
      reversalAmount,
      original.bank_account,
      reversalReference,
      reversalDepositorName,
      reversalProof,
      original.id,
      reason,
      notes || null,
      deposited_by || null,
      deposited_at || null,
    ]);

    await client.query(
      `
        UPDATE bank_deposits
        SET
          status = 'reversed',
          reversed_by = $2,
          reversed_at = now(),
          reversal_reason = COALESCE(reversal_reason, $3),
          updated_at = now()
        WHERE id = $1
      `,
      [original.id, deposited_by || null, reason]
    );

    await client.query('COMMIT');
    return findById(reversalRes.rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK');
    if (String(err.message || '').includes('ux_bank_deposits_reference_number')) {
      throw new Error('reference_number must be unique');
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  create,
  findById,
  list,
  reverse,
};