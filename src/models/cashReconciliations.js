const { pool } = require('../db');

function toMoney(value) {
  const n = Number(value || 0);
  if (Number.isNaN(n)) return 0;
  return Number(n.toFixed(2));
}

const RECONCILIATION_SELECT = `
  cr.*,
  COALESCE((
    SELECT SUM(pt.gross_amount)
    FROM prepaid_load_transactions pt
    WHERE pt.branch_id = cr.branch_id
      AND pt.created_at >= cr.business_date::date
      AND pt.created_at < (cr.business_date::date + INTERVAL '1 day')
  ), 0) AS prepaid_load_total,
  COALESCE((
    SELECT SUM(bd.amount)
    FROM bank_deposits bd
    WHERE bd.branch_id = cr.branch_id
      AND bd.business_date = cr.business_date
  ), 0) AS total_bank_deposit_amount,
  CASE
    WHEN cr.closed_at IS NULL THEN NULL
    ELSE GREATEST(
      COALESCE(cr.actual_cash_on_hand, 0) - COALESCE((
        SELECT SUM(bd.amount)
        FROM bank_deposits bd
        WHERE bd.branch_id = cr.branch_id
          AND bd.business_date = cr.business_date
      ), 0),
      0
    )
  END AS remaining_cash_on_register
`;

async function getSalesTotals(client, { branch_id, business_date }) {
  const date = business_date;

  // Total sales counts merchandise orders plus GCash and prepaid load at their
  // full gross amount, matching the throughput definition used by the sales
  // reports. This figure is for display only -- expected cash on hand is
  // derived from cash_sales_amount and other_cash_impact_amount instead.
  const totalSalesSql = `
    SELECT (
      COALESCE((
        SELECT SUM(o.total_amount)
        FROM orders o
        WHERE o.order_status NOT IN ('cancelled')
          AND o.branch_id = $1
          AND o.created_at >= $2::date
          AND o.created_at < ($2::date + INTERVAL '1 day')
      ), 0)
      + COALESCE((
        SELECT SUM(gt.gross_amount)
        FROM gcash_transactions gt
        WHERE gt.branch_id = $1
          AND gt.created_at >= $2::date
          AND gt.created_at < ($2::date + INTERVAL '1 day')
      ), 0)
      + COALESCE((
        SELECT SUM(pt.gross_amount)
        FROM prepaid_load_transactions pt
        WHERE pt.branch_id = $1
          AND pt.created_at >= $2::date
          AND pt.created_at < ($2::date + INTERVAL '1 day')
      ), 0)
    ) AS total_sales_amount
  `;

  // All expenses are treated as cash paid out of the register; the expenses
  // table has no payment-method column to distinguish otherwise.
  const expensesSql = `
    SELECT COALESCE(SUM(e.amount), 0) AS total_expenses_amount
    FROM expenses e
    WHERE e.branch_id = $1
      AND e.expense_date = $2::date
  `;

  const cashSalesSql = `
    SELECT COALESCE(SUM(p.amount), 0) AS cash_sales_amount
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE p.payment_method = 'cash'
      AND o.order_status NOT IN ('cancelled')
      AND o.branch_id = $1
      AND p.payment_date >= $2::date
      AND p.payment_date < ($2::date + INTERVAL '1 day')
  `;

  const otherCashImpactSql = `
    SELECT COALESCE(SUM(x.cash_impact), 0) AS other_cash_impact_amount
    FROM (
      SELECT
        CASE
          WHEN gt.service_type = 'cash_out' THEN (-ABS(COALESCE(gt.principal_amount, 0)))
          WHEN gt.service_type = 'cash_in' THEN ABS(COALESCE(gt.gross_amount, gt.cash_impact, 0))
          ELSE COALESCE(gt.cash_impact, 0)
        END AS cash_impact
      FROM gcash_transactions gt
      WHERE gt.branch_id = $1
        AND gt.created_at >= $2::date
        AND gt.created_at < ($2::date + INTERVAL '1 day')

      UNION ALL

      SELECT pt.cash_impact
      FROM prepaid_load_transactions pt
      WHERE pt.branch_id = $1
        AND pt.created_at >= $2::date
        AND pt.created_at < ($2::date + INTERVAL '1 day')
    ) x
  `;

  const gcashBreakdownSql = `
    SELECT
      COALESCE(SUM(CASE WHEN gt.service_type = 'cash_in' THEN ABS(COALESCE(gt.gross_amount, gt.cash_impact, 0)) ELSE 0 END), 0) AS gcash_cash_in_total,
      COALESCE(SUM(CASE WHEN gt.service_type = 'cash_out' THEN ABS(COALESCE(gt.principal_amount, gt.cash_impact, 0)) ELSE 0 END), 0) AS gcash_cash_out_total
    FROM gcash_transactions gt
    WHERE gt.branch_id = $1
      AND gt.created_at >= $2::date
      AND gt.created_at < ($2::date + INTERVAL '1 day')
  `;

  const prepaidTotalSql = `
    SELECT COALESCE(SUM(pt.gross_amount), 0) AS prepaid_load_total
    FROM prepaid_load_transactions pt
    WHERE pt.branch_id = $1
      AND pt.created_at >= $2::date
      AND pt.created_at < ($2::date + INTERVAL '1 day')
  `;

  const [
    totalSalesRes,
    cashSalesRes,
    otherCashImpactRes,
    gcashBreakdownRes,
    expensesRes,
    prepaidTotalRes,
  ] = await Promise.all([
    client.query(totalSalesSql, [branch_id, date]),
    client.query(cashSalesSql, [branch_id, date]),
    client.query(otherCashImpactSql, [branch_id, date]),
    client.query(gcashBreakdownSql, [branch_id, date]),
    client.query(expensesSql, [branch_id, date]),
    client.query(prepaidTotalSql, [branch_id, date]),
  ]);

  return {
    total_sales_amount: toMoney(totalSalesRes.rows[0]?.total_sales_amount),
    cash_sales_amount: toMoney(cashSalesRes.rows[0]?.cash_sales_amount),
    other_cash_impact_amount: toMoney(otherCashImpactRes.rows[0]?.other_cash_impact_amount),
    gcash_cash_in_total: toMoney(gcashBreakdownRes.rows[0]?.gcash_cash_in_total),
    gcash_cash_out_total: toMoney(gcashBreakdownRes.rows[0]?.gcash_cash_out_total),
    total_expenses_amount: toMoney(expensesRes.rows[0]?.total_expenses_amount),
    prepaid_load_total: toMoney(prepaidTotalRes.rows[0]?.prepaid_load_total),
  };
}

/**
 * Expected cash on hand at close:
 *   opening + cash sales + net other cash impact - cash expenses
 *
 * Bank deposits are deliberately excluded: they are made after the closing
 * count, so they reduce remaining_cash_on_register rather than expected cash.
 */
function computeExpectedCash(openingCashTotal, totals) {
  return toMoney(
    Number(openingCashTotal || 0)
    + Number(totals.cash_sales_amount || 0)
    + Number(totals.other_cash_impact_amount || 0)
    - Number(totals.total_expenses_amount || 0)
  );
}

async function openDay({ branch_id, business_date, opening_cash_breakdown, opening_cash_total, notes, opened_by }) {
  const sql = `
    INSERT INTO cash_reconciliations (
      branch_id,
      business_date,
      opening_cash_breakdown,
      opening_cash_total,
      notes,
      opened_by,
      opened_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3::jsonb, $4, $5, $6, now(), now(), now())
    RETURNING *
  `;

  const params = [
    branch_id,
    business_date,
    JSON.stringify(opening_cash_breakdown || []),
    toMoney(opening_cash_total),
    notes || null,
    opened_by || null,
  ];

  const { rows } = await pool.query(sql, params);
  return findById(rows[0].id);
}

async function upsertOpeningDay({ branch_id, business_date, opening_cash_breakdown, opening_cash_total, notes, opened_by }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingRes = await client.query(
      'SELECT * FROM cash_reconciliations WHERE branch_id = $1 AND business_date = $2::date FOR UPDATE',
      [branch_id, business_date]
    );
    const existing = existingRes.rows[0];

    if (!existing) {
      const insertSql = `
        INSERT INTO cash_reconciliations (
          branch_id,
          business_date,
          opening_cash_breakdown,
          opening_cash_total,
          notes,
          opened_by,
          opened_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2::date, $3::jsonb, $4, $5, $6, now(), now(), now())
        RETURNING *
      `;
      const createdRes = await client.query(insertSql, [
        branch_id,
        business_date,
        JSON.stringify(opening_cash_breakdown || []),
        toMoney(opening_cash_total),
        notes || null,
        opened_by || null,
      ]);
      const created = createdRes.rows[0];
      await client.query('COMMIT');
      return findById(created.id);
    }

    if (existing.closed_at) {
      throw new Error('cannot update opening cash because this day is already closed');
    }

    const updateSql = `
      UPDATE cash_reconciliations
      SET
        opening_cash_breakdown = $3::jsonb,
        opening_cash_total = $4,
        notes = COALESCE($5, notes),
        opened_by = COALESCE($6, opened_by),
        updated_at = now()
      WHERE branch_id = $1
        AND business_date = $2::date
      RETURNING *
    `;
    const { rows } = await client.query(updateSql, [
      branch_id,
      business_date,
      JSON.stringify(opening_cash_breakdown || []),
      toMoney(opening_cash_total),
      notes || null,
      opened_by || null,
    ]);

    await client.query('COMMIT');
    return findById(rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closeDay({ id, closing_cash_breakdown, closing_cash_total, closed_by, notes }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingRes = await client.query('SELECT * FROM cash_reconciliations WHERE id = $1 FOR UPDATE', [id]);
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error('cash reconciliation not found');
    }
    if (existing.closed_at) {
      throw new Error('this day is already closed');
    }

    const totals = await getSalesTotals(client, {
      branch_id: existing.branch_id,
      business_date: existing.business_date,
    });

    const expectedCash = computeExpectedCash(existing.opening_cash_total, totals);
    const actualCash = toMoney(closing_cash_total);
    const variance = toMoney(actualCash - expectedCash);
    const isShort = variance < 0;

    const updateSql = `
      UPDATE cash_reconciliations
      SET
        closing_cash_breakdown = $2::jsonb,
        closing_cash_total = $3,
        total_sales_amount = $4,
        cash_sales_amount = $5,
        other_cash_impact_amount = $6,
        gcash_cash_in_total = $7,
        gcash_cash_out_total = $8,
        total_expenses_amount = $9,
        expected_cash_on_hand = $10,
        actual_cash_on_hand = $11,
        variance_amount = $12,
        is_short = $13,
        closed_by = $14,
        notes = COALESCE($15, notes),
        closed_at = now(),
        updated_at = now()
      WHERE id = $1
      RETURNING *
    `;

    const params = [
      id,
      JSON.stringify(closing_cash_breakdown || []),
      actualCash,
      totals.total_sales_amount,
      totals.cash_sales_amount,
      totals.other_cash_impact_amount,
      totals.gcash_cash_in_total,
      totals.gcash_cash_out_total,
      totals.total_expenses_amount,
      expectedCash,
      actualCash,
      variance,
      isShort,
      closed_by || null,
      notes || null,
    ];

    const { rows } = await client.query(updateSql, params);
    await client.query('COMMIT');
    return findById(rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Compute the same totals closeDay would use, without writing anything.
 * The Closing screen reads this so the figures a cashier approves are exactly
 * the figures that get stored.
 */
async function previewClose(id) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM cash_reconciliations WHERE id = $1 LIMIT 1', [id]);
    const existing = rows[0];
    if (!existing) {
      throw new Error('cash reconciliation not found');
    }

    const totals = await getSalesTotals(client, {
      branch_id: existing.branch_id,
      business_date: existing.business_date,
    });

    return {
      id: existing.id,
      branch_id: existing.branch_id,
      business_date: existing.business_date,
      opening_cash_total: toMoney(existing.opening_cash_total),
      closed_at: existing.closed_at,
      ...totals,
      expected_cash_on_hand: computeExpectedCash(existing.opening_cash_total, totals),
    };
  } finally {
    client.release();
  }
}

async function findById(id) {
  const { rows } = await pool.query(`
    SELECT
      ${RECONCILIATION_SELECT}
    FROM cash_reconciliations cr
    WHERE cr.id = $1
    LIMIT 1
  `, [id]);
  return rows[0] || null;
}

async function list({ limit = 100, offset = 0, branch_id, from, to } = {}) {
  const params = [];
  const where = [];

  if (branch_id) {
    params.push(branch_id);
    where.push(`cr.branch_id = $${params.length}`);
  }

  if (from) {
    params.push(from);
    where.push(`cr.business_date >= $${params.length}::date`);
  }

  if (to) {
    params.push(to);
    where.push(`cr.business_date <= $${params.length}::date`);
  }

  params.push(Number(limit) || 100);
  params.push(Number(offset) || 0);

  const sql = `
    SELECT
      ${RECONCILIATION_SELECT}
    FROM cash_reconciliations cr
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY cr.business_date DESC, cr.created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function deleteById(id) {
  const sql = 'DELETE FROM cash_reconciliations WHERE id = $1 RETURNING *';
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

module.exports = {
  openDay,
  upsertOpeningDay,
  closeDay,
  previewClose,
  findById,
  list,
  deleteById,
};
