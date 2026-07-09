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

  const where = whereParts.join(' AND ');

  const sql = `
    SELECT
      DATE_TRUNC('${trunc}', o.created_at) AS period,
      COUNT(DISTINCT o.id)                  AS order_count,
      COALESCE(SUM(o.total_amount + COALESCE(o.discount_amount, 0)), 0) AS gross_sales,
      COALESCE(SUM(o.discount_amount), 0)   AS total_discounts,
      COALESCE(SUM(o.total_amount), 0)       AS net_sales,
      COALESCE(SUM(oi.quantity), 0)          AS items_sold
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1
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

  if (branch_id) {
    params.push(branch_id);
    whereParts.push(`o.branch_id = $${params.length}`);
  }

  const where = whereParts.join(' AND ');

  const sql = `
    SELECT
      p.payment_method,
      COUNT(p.id)        AS transaction_count,
      COALESCE(SUM(p.amount), 0) AS total_amount
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
    GROUP BY p.payment_method
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

  const params = [fromDate, toDate, Number(limit) || 10];
  const whereParts = [
    `o.order_status NOT IN ('cancelled')`,
    `o.created_at >= $1::date`,
    `o.created_at < ($2::date + INTERVAL '1 day')`,
  ];

  if (branch_id) {
    params.push(branch_id);
    whereParts.push(`o.branch_id = $${params.length}`);
  }

  const where = whereParts.join(' AND ');

  const sql = `
    SELECT
      pv.id                       AS product_variant_id,
      pv.sku,
      p.product_name,
      pv.size,
      pv.color,
      pv.class,
      COALESCE(SUM(oi.quantity), 0)  AS units_sold,
      COALESCE(SUM(oi.subtotal), 0)  AS total_revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE ${where}
    GROUP BY pv.id, pv.sku, p.product_name, pv.size, pv.color, pv.class
    ORDER BY total_revenue DESC
    LIMIT $3
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

  const where = whereParts.join(' AND ');

  const sql = `
    SELECT
      COUNT(DISTINCT o.id)                                                      AS order_count,
      COALESCE(SUM(o.total_amount + COALESCE(o.discount_amount, 0)), 0)        AS gross_sales,
      COALESCE(SUM(o.discount_amount), 0)                                       AS total_discounts,
      COALESCE(SUM(o.total_amount), 0)                                          AS net_sales,
      COALESCE(SUM(oi.quantity), 0)                                             AS items_sold,
      COALESCE(AVG(o.total_amount), 0)                                          AS avg_order_value
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE ${where}
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
      cr.expected_cash_on_hand,
      cr.closing_cash_breakdown,
      cr.actual_cash_on_hand,
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
