const { pool } = require('../db');

/**
 * Resolve the DATE_TRUNC truncation unit and default date range for each period.
 * Returns { trunc, defaultFrom, defaultTo }
 */
function resolvePeriod(period) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  switch (period) {
    case 'daily': {
      // Last 30 days
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      const fromStr = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
      return { trunc: 'day', defaultFrom: fromStr, defaultTo: today };
    }
    case 'weekly': {
      // Last 12 weeks
      const from = new Date(now);
      from.setDate(from.getDate() - 83);
      const fromStr = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
      return { trunc: 'week', defaultFrom: fromStr, defaultTo: today };
    }
    case 'monthly': {
      // Last 12 months
      const from = new Date(now);
      from.setMonth(from.getMonth() - 11);
      from.setDate(1);
      const fromStr = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`;
      return { trunc: 'month', defaultFrom: fromStr, defaultTo: today };
    }
    case 'yearly': {
      // Last 5 years
      const fromYear = now.getFullYear() - 4;
      return { trunc: 'year', defaultFrom: `${fromYear}-01-01`, defaultTo: today };
    }
    case 'custom':
    default:
      return { trunc: 'day', defaultFrom: today, defaultTo: today };
  }
}

/**
 * Sales summary grouped by the given period.
 *
 * Filters (all optional):
 *   from          – ISO date string (inclusive start)
 *   to            – ISO date string (inclusive end, through end of day)
 *   branch_id     – UUID
 *   sales_channel_id – UUID
 */
async function getSalesSummary({ period = 'daily', from, to, branch_id, sales_channel_id } = {}) {
  const { trunc, defaultFrom, defaultTo } = resolvePeriod(period);
  const fromDate = from || defaultFrom;
  const toDate = to || defaultTo;
  const includePrepaid = !sales_channel_id;

  const params = [fromDate, toDate];
  const whereParts = [
    `o.order_status NOT IN ('cancelled')`,
    `o.created_at >= $1::date`,
    `o.created_at < ($2::date + INTERVAL '1 day')`,
  ];

  if (branch_id) {
    params.push(branch_id);
    whereParts.push(`o.branch_id = $${params.length}`);
  }
  if (sales_channel_id) {
    params.push(sales_channel_id);
    whereParts.push(`o.sales_channel_id = $${params.length}`);
  }

  params.push(includePrepaid);
  const includePrepaidParam = params.length;

  let prepaidBranchFilter = '';
  if (branch_id) {
    prepaidBranchFilter = `AND pt.branch_id = $3`;
  }

  const where = whereParts.join(' AND ');

  const sql = `
    WITH order_rows AS (
      SELECT
        DATE_TRUNC('${trunc}', o.created_at) AS period,
        COUNT(DISTINCT o.id) AS order_count,
        COALESCE(SUM(o.total_amount + COALESCE(o.discount_amount, 0)), 0) AS gross_sales,
        COALESCE(SUM(o.discount_amount), 0) AS total_discounts,
        COALESCE(SUM(o.total_amount), 0) AS net_sales,
        COALESCE(SUM(oi.quantity), 0) AS items_sold
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${where}
      GROUP BY 1
    ),
    prepaid_rows AS (
      SELECT
        DATE_TRUNC('${trunc}', pt.created_at) AS period,
        COUNT(pt.id) AS order_count,
        COALESCE(SUM(pt.gross_amount), 0) AS gross_sales,
        0::numeric AS total_discounts,
        COALESCE(SUM(pt.gross_amount), 0) AS net_sales,
        COUNT(pt.id) AS items_sold
      FROM prepaid_load_transactions pt
      WHERE pt.created_at >= $1::date
        AND pt.created_at < ($2::date + INTERVAL '1 day')
        ${prepaidBranchFilter}
        AND $${includePrepaidParam}::boolean = TRUE
      GROUP BY 1
    )
    SELECT
      period,
      COALESCE(SUM(order_count), 0)::bigint AS order_count,
      COALESCE(SUM(gross_sales), 0) AS gross_sales,
      COALESCE(SUM(total_discounts), 0) AS total_discounts,
      COALESCE(SUM(net_sales), 0) AS net_sales,
      COALESCE(SUM(items_sold), 0)::bigint AS items_sold
    FROM (
      SELECT * FROM order_rows
      UNION ALL
      SELECT * FROM prepaid_rows
    ) x
    GROUP BY period
    ORDER BY period
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Payment method breakdown within a date range.
 */
async function getPaymentBreakdown({ from, to, branch_id } = {}) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const fromDate = from || today;
  const toDate = to || today;

  const params = [fromDate, toDate];
  const whereParts = [
    `p.payment_date >= $1::date`,
    `p.payment_date < ($2::date + INTERVAL '1 day')`,
    `o.order_status NOT IN ('cancelled')`,
  ];
  const prepaidWhereParts = [
    `pt.created_at >= $1::date`,
    `pt.created_at < ($2::date + INTERVAL '1 day')`,
  ];

  if (branch_id) {
    params.push(branch_id);
    whereParts.push(`o.branch_id = $${params.length}`);
    prepaidWhereParts.push(`pt.branch_id = $${params.length}`);
  }

  const where = whereParts.join(' AND ');
  const prepaidWhere = prepaidWhereParts.join(' AND ');

  const sql = `
    SELECT
      x.payment_method,
      SUM(x.transaction_count)::bigint AS transaction_count,
      COALESCE(SUM(x.total_amount), 0) AS total_amount
    FROM (
      SELECT
        p.payment_method,
        COUNT(p.id) AS transaction_count,
        COALESCE(SUM(p.amount), 0) AS total_amount
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE ${where}
      GROUP BY p.payment_method

      UNION ALL

      SELECT
        'cash'::text AS payment_method,
        COUNT(pt.id) AS transaction_count,
        COALESCE(SUM(pt.gross_amount), 0) AS total_amount
      FROM prepaid_load_transactions pt
      WHERE ${prepaidWhere}
    ) x
    GROUP BY x.payment_method
    ORDER BY total_amount DESC
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Top-selling product variants by revenue within a date range.
 */
async function getTopProducts({ from, to, branch_id, limit = 10 } = {}) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const fromDate = from || today;
  const toDate = to || today;

  const params = [fromDate, toDate];
  const whereParts = [
    `o.order_status NOT IN ('cancelled')`,
    `o.created_at >= $1::date`,
    `o.created_at < ($2::date + INTERVAL '1 day')`,
  ];
  const prepaidWhereParts = [
    `pt.created_at >= $1::date`,
    `pt.created_at < ($2::date + INTERVAL '1 day')`,
  ];

  if (branch_id) {
    params.push(branch_id);
    whereParts.push(`o.branch_id = $${params.length}`);
    prepaidWhereParts.push(`pt.branch_id = $${params.length}`);
  }

  params.push(Number(limit) || 10);
  const limitParam = params.length;

  const where = whereParts.join(' AND ');
  const prepaidWhere = prepaidWhereParts.join(' AND ');

  const sql = `
    SELECT
      x.product_variant_id,
      x.sku,
      x.product_name,
      x.size,
      x.color,
      x.class,
      SUM(x.units_sold)::bigint AS units_sold,
      COALESCE(SUM(x.total_revenue), 0) AS total_revenue
    FROM (
      SELECT
        pv.id AS product_variant_id,
        pv.sku,
        p.product_name,
        pv.size,
        pv.color,
        pv.class,
        COALESCE(SUM(oi.quantity), 0) AS units_sold,
        COALESCE(SUM(oi.subtotal), 0) AS total_revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
      LEFT JOIN products p ON p.id = pv.product_id
      WHERE ${where}
      GROUP BY pv.id, pv.sku, p.product_name, pv.size, pv.color, pv.class

      UNION ALL

      SELECT
        pt.product_id AS product_variant_id,
        plp.product_code AS sku,
        plp.product_name,
        ''::text AS size,
        ''::text AS color,
        'prepaid_load'::text AS class,
        COUNT(pt.id) AS units_sold,
        COALESCE(SUM(pt.gross_amount), 0) AS total_revenue
      FROM prepaid_load_transactions pt
      LEFT JOIN prepaid_load_products plp ON plp.id = pt.product_id
      WHERE ${prepaidWhere}
      GROUP BY pt.product_id, plp.product_code, plp.product_name
    ) x
    GROUP BY x.product_variant_id, x.sku, x.product_name, x.size, x.color, x.class
    ORDER BY total_revenue DESC
    LIMIT $${limitParam}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Overall summary totals for a given date range (for dashboard KPI cards).
 */
async function getOverviewSummary({ from, to, branch_id, sales_channel_id } = {}) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const fromDate = from || today;
  const toDate = to || today;
  const includePrepaid = !sales_channel_id;

  const params = [fromDate, toDate];
  const whereParts = [
    `o.order_status NOT IN ('cancelled')`,
    `o.created_at >= $1::date`,
    `o.created_at < ($2::date + INTERVAL '1 day')`,
  ];

  if (branch_id) {
    params.push(branch_id);
    whereParts.push(`o.branch_id = $${params.length}`);
  }
  if (sales_channel_id) {
    params.push(sales_channel_id);
    whereParts.push(`o.sales_channel_id = $${params.length}`);
  }

  params.push(includePrepaid);
  const includePrepaidParam = params.length;

  let prepaidBranchFilter = '';
  if (branch_id) {
    prepaidBranchFilter = `AND pt.branch_id = $3`;
  }

  const where = whereParts.join(' AND ');

  const sql = `
    WITH order_totals AS (
      SELECT
        COUNT(DISTINCT o.id) AS order_count,
        COALESCE(SUM(o.total_amount + COALESCE(o.discount_amount, 0)), 0) AS gross_sales,
        COALESCE(SUM(o.discount_amount), 0) AS total_discounts,
        COALESCE(SUM(o.total_amount), 0) AS net_sales,
        COALESCE(SUM(oi.quantity), 0) AS items_sold
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${where}
    ),
    prepaid_totals AS (
      SELECT
        COUNT(pt.id) AS order_count,
        COALESCE(SUM(pt.gross_amount), 0) AS gross_sales,
        0::numeric AS total_discounts,
        COALESCE(SUM(pt.gross_amount), 0) AS net_sales,
        COUNT(pt.id) AS items_sold
      FROM prepaid_load_transactions pt
      WHERE pt.created_at >= $1::date
        AND pt.created_at < ($2::date + INTERVAL '1 day')
        ${prepaidBranchFilter}
        AND $${includePrepaidParam}::boolean = TRUE
    )
    SELECT
      (COALESCE(o.order_count, 0) + COALESCE(p.order_count, 0))::bigint AS order_count,
      COALESCE(o.gross_sales, 0) + COALESCE(p.gross_sales, 0) AS gross_sales,
      COALESCE(o.total_discounts, 0) + COALESCE(p.total_discounts, 0) AS total_discounts,
      COALESCE(o.net_sales, 0) + COALESCE(p.net_sales, 0) AS net_sales,
      (COALESCE(o.items_sold, 0) + COALESCE(p.items_sold, 0))::bigint AS items_sold,
      CASE
        WHEN (COALESCE(o.order_count, 0) + COALESCE(p.order_count, 0)) = 0 THEN 0
        ELSE (COALESCE(o.net_sales, 0) + COALESCE(p.net_sales, 0)) / (COALESCE(o.order_count, 0) + COALESCE(p.order_count, 0))
      END AS avg_order_value
    FROM order_totals o
    CROSS JOIN prepaid_totals p
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0] || {};
}

/**
 * Daily cash reconciliation report for a branch and business date.
 */
async function getDailyCashReconciliation({ branch_id, business_date } = {}) {
  const sql = `
    SELECT
      cr.id,
      cr.branch_id,
      cr.business_date,
      cr.opening_cash_breakdown,
      cr.opening_cash_total,
      cr.total_sales_amount,
      cr.cash_sales_amount,
      cr.other_cash_impact_amount,
      cr.gcash_cash_in_total,
      cr.gcash_cash_out_total,
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
      cr.expected_cash_on_hand,
      cr.closing_cash_breakdown,
      cr.actual_cash_on_hand,
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
      END AS remaining_cash_on_register,
      cr.variance_amount,
      cr.is_short,
      cr.opened_by,
      cr.closed_by,
      cr.opened_at,
      cr.closed_at,
      cr.created_at,
      cr.updated_at,
      b.branch_name
    FROM cash_reconciliations cr
    LEFT JOIN branches b ON b.id = cr.branch_id
    WHERE cr.branch_id = $1
      AND cr.business_date = $2::date
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [branch_id, business_date]);
  return rows[0] || null;
}

module.exports = { getSalesSummary, getPaymentBreakdown, getTopProducts, getOverviewSummary, getDailyCashReconciliation };
