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
  const includeServicesParam = params.length;

  let prepaidBranchFilter = '';
  let gcashBranchFilter = '';
  if (branch_id) {
    prepaidBranchFilter = `AND pt.branch_id = $3`;
    gcashBranchFilter = `AND gt.branch_id = $3`;
  }

  const where = whereParts.join(' AND ');

  const sql = `
    WITH order_items_rollup AS (
      SELECT order_id, SUM(quantity) AS item_qty
      FROM order_items
      GROUP BY order_id
    ),
    order_rows AS (
      SELECT
        DATE_TRUNC('${trunc}', o.created_at) AS period,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total_amount + COALESCE(o.discount_amount, 0)), 0) AS gross_sales,
        COALESCE(SUM(COALESCE(o.discount_amount, 0)), 0) AS total_discounts,
        COALESCE(SUM(o.total_amount), 0) AS net_sales,
        COALESCE(SUM(COALESCE(oi.item_qty, 0)), 0) AS items_sold
      FROM orders o
      LEFT JOIN order_items_rollup oi ON oi.order_id = o.id
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
        AND $${includeServicesParam}::boolean = TRUE
      GROUP BY 1
    ),
    gcash_rows AS (
      SELECT
        DATE_TRUNC('${trunc}', gt.created_at) AS period,
        COUNT(gt.id) AS order_count,
        COALESCE(SUM(gt.gross_amount), 0) AS gross_sales,
        0::numeric AS total_discounts,
        COALESCE(SUM(gt.gross_amount), 0) AS net_sales,
        COUNT(gt.id) AS items_sold
      FROM gcash_transactions gt
      WHERE gt.created_at >= $1::date
        AND gt.created_at < ($2::date + INTERVAL '1 day')
        ${gcashBranchFilter}
        AND $${includeServicesParam}::boolean = TRUE
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
      UNION ALL
      SELECT * FROM gcash_rows
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
  const gcashWhereParts = [
    `gt.created_at >= $1::date`,
    `gt.created_at < ($2::date + INTERVAL '1 day')`,
  ];

  if (branch_id) {
    params.push(branch_id);
    whereParts.push(`o.branch_id = $${params.length}`);
    prepaidWhereParts.push(`pt.branch_id = $${params.length}`);
    gcashWhereParts.push(`gt.branch_id = $${params.length}`);
  }

  const where = whereParts.join(' AND ');
  const prepaidWhere = prepaidWhereParts.join(' AND ');
  const gcashWhere = gcashWhereParts.join(' AND ');

  const sql = `
    SELECT
      x.payment_method,
      SUM(x.transaction_count)::bigint AS transaction_count,
      COALESCE(SUM(x.total_amount), 0) AS total_amount
    FROM (
      SELECT
        p.payment_method::text AS payment_method,
        COUNT(p.id) AS transaction_count,
        COALESCE(SUM(p.amount), 0) AS total_amount
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE ${where}
      GROUP BY p.payment_method

      UNION ALL

      SELECT
        'prepaid_load'::text AS payment_method,
        COUNT(pt.id) AS transaction_count,
        COALESCE(SUM(pt.gross_amount), 0) AS total_amount
      FROM prepaid_load_transactions pt
      WHERE ${prepaidWhere}

      UNION ALL

      -- GCash cash-in/cash-out services are reported separately from the
      -- 'gcash' payment method, which means a retail order settled by GCash
      -- transfer. Merging them would conflate two different things.
      SELECT
        'gcash_service'::text AS payment_method,
        COUNT(gt.id) AS transaction_count,
        COALESCE(SUM(gt.gross_amount), 0) AS total_amount
      FROM gcash_transactions gt
      WHERE ${gcashWhere}
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
  const includeServicesParam = params.length;

  let prepaidBranchFilter = '';
  let gcashBranchFilter = '';
  if (branch_id) {
    prepaidBranchFilter = `AND pt.branch_id = $3`;
    gcashBranchFilter = `AND gt.branch_id = $3`;
  }

  const where = whereParts.join(' AND ');

  const sql = `
    WITH order_items_rollup AS (
      SELECT order_id, SUM(quantity) AS item_qty
      FROM order_items
      GROUP BY order_id
    ),
    order_totals AS (
      SELECT
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total_amount + COALESCE(o.discount_amount, 0)), 0) AS gross_sales,
        COALESCE(SUM(COALESCE(o.discount_amount, 0)), 0) AS total_discounts,
        COALESCE(SUM(o.total_amount), 0) AS net_sales,
        COALESCE(SUM(COALESCE(oi.item_qty, 0)), 0) AS items_sold
      FROM orders o
      LEFT JOIN order_items_rollup oi ON oi.order_id = o.id
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
        AND $${includeServicesParam}::boolean = TRUE
    ),
    gcash_totals AS (
      SELECT
        COUNT(gt.id) AS order_count,
        COALESCE(SUM(gt.gross_amount), 0) AS gross_sales,
        0::numeric AS total_discounts,
        COALESCE(SUM(gt.gross_amount), 0) AS net_sales,
        COUNT(gt.id) AS items_sold
      FROM gcash_transactions gt
      WHERE gt.created_at >= $1::date
        AND gt.created_at < ($2::date + INTERVAL '1 day')
        ${gcashBranchFilter}
        AND $${includeServicesParam}::boolean = TRUE
    )
    SELECT
      (COALESCE(o.order_count, 0) + COALESCE(p.order_count, 0) + COALESCE(g.order_count, 0))::bigint AS order_count,
      COALESCE(o.gross_sales, 0) + COALESCE(p.gross_sales, 0) + COALESCE(g.gross_sales, 0) AS gross_sales,
      COALESCE(o.total_discounts, 0) + COALESCE(p.total_discounts, 0) + COALESCE(g.total_discounts, 0) AS total_discounts,
      COALESCE(o.net_sales, 0) + COALESCE(p.net_sales, 0) + COALESCE(g.net_sales, 0) AS net_sales,
      (COALESCE(o.items_sold, 0) + COALESCE(p.items_sold, 0) + COALESCE(g.items_sold, 0))::bigint AS items_sold,
      CASE
        WHEN (COALESCE(o.order_count, 0) + COALESCE(p.order_count, 0) + COALESCE(g.order_count, 0)) = 0 THEN 0
        ELSE (COALESCE(o.net_sales, 0) + COALESCE(p.net_sales, 0) + COALESCE(g.net_sales, 0))
             / (COALESCE(o.order_count, 0) + COALESCE(p.order_count, 0) + COALESCE(g.order_count, 0))
      END AS avg_order_value
    FROM order_totals o
    CROSS JOIN prepaid_totals p
    CROSS JOIN gcash_totals g
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
      cr.total_expenses_amount,
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

function round2(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/**
 * Line-item profitability across merchandise, GCash services, and prepaid
 * load, all on one shared shape (total / capital_cost / gain) so the report
 * doesn't need a separate definition of margin per source.
 *
 *   merchandise   total = subtotal,       capital = cost_price * qty
 *   gcash         total = gross_amount,   capital = principal_amount   (gain = fee_amount)
 *   prepaid_load  total = gross_amount,   capital = face_value         (gain = markup_amount)
 *
 * Cancelled orders are excluded, matching every other sales query in this file.
 * Filtering by sales_channel_id excludes GCash/prepaid rows (they have no
 * sales channel), the same rule used by getSalesSummary/getOverviewSummary.
 */
async function getProfitability({ from, to, branch_id, sales_channel_id } = {}) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const fromDate = from || today;
  const toDate = to || today;
  const includeServices = !sales_channel_id;

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

  params.push(includeServices);
  const includeServicesParam = params.length;

  let gcashBranchFilter = '';
  let prepaidBranchFilter = '';
  if (branch_id) {
    gcashBranchFilter = `AND gt.branch_id = $3`;
    prepaidBranchFilter = `AND pt.branch_id = $3`;
  }

  const where = whereParts.join(' AND ');

  const sql = `
    SELECT * FROM (
      SELECT
        'merchandise'::text AS source,
        o.created_at AS occurred_at,
        COALESCE(b.branch_name, '-') AS branch,
        COALESCE(sc.channel_name, 'POS') AS sales_channel,
        COALESCE(c.full_name, '-') AS customer,
        COALESCE(p.product_name, '-') AS product,
        COALESCE(NULLIF(CONCAT_WS(' / ', NULLIF(pv.size, ''), NULLIF(pv.color, ''), NULLIF(pv.class, '')), ''), '-') AS variant,
        oi.unit_price AS price,
        oi.quantity::numeric AS qty,
        oi.subtotal AS total,
        COALESCE(pv.cost_price, 0) AS cost_price,
        COALESCE(pv.cost_price, 0) * oi.quantity AS capital_cost,
        oi.subtotal - COALESCE(pv.cost_price, 0) * oi.quantity AS gain
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
      LEFT JOIN products p ON p.id = pv.product_id
      LEFT JOIN branches b ON b.id = o.branch_id
      LEFT JOIN sales_channels sc ON sc.id = o.sales_channel_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE ${where}

      UNION ALL

      SELECT
        'gcash'::text AS source,
        gt.created_at AS occurred_at,
        COALESCE(b.branch_name, '-') AS branch,
        'GCash'::text AS sales_channel,
        COALESCE(c.full_name, '-') AS customer,
        CASE gt.service_type WHEN 'cash_in' THEN 'GCash Cash In' ELSE 'GCash Cash Out' END AS product,
        gt.reference_number AS variant,
        gt.gross_amount AS price,
        1::numeric AS qty,
        gt.gross_amount AS total,
        gt.principal_amount AS cost_price,
        gt.principal_amount AS capital_cost,
        gt.fee_amount AS gain
      FROM gcash_transactions gt
      LEFT JOIN branches b ON b.id = gt.branch_id
      LEFT JOIN customers c ON c.id = gt.customer_id
      WHERE gt.created_at >= $1::date
        AND gt.created_at < ($2::date + INTERVAL '1 day')
        ${gcashBranchFilter}
        AND $${includeServicesParam}::boolean = TRUE

      UNION ALL

      SELECT
        'prepaid_load'::text AS source,
        pt.created_at AS occurred_at,
        COALESCE(b.branch_name, '-') AS branch,
        'Prepaid Load'::text AS sales_channel,
        COALESCE(c.full_name, '-') AS customer,
        CONCAT(UPPER(pt.carrier::text), ' - ', COALESCE(plp.product_name, 'Load')) AS product,
        pt.recipient_mobile_no AS variant,
        pt.gross_amount AS price,
        1::numeric AS qty,
        pt.gross_amount AS total,
        pt.face_value AS cost_price,
        pt.face_value AS capital_cost,
        pt.markup_amount AS gain
      FROM prepaid_load_transactions pt
      LEFT JOIN prepaid_load_products plp ON plp.id = pt.product_id
      LEFT JOIN branches b ON b.id = pt.branch_id
      LEFT JOIN customers c ON c.id = pt.customer_id
      WHERE pt.created_at >= $1::date
        AND pt.created_at < ($2::date + INTERVAL '1 day')
        ${prepaidBranchFilter}
        AND $${includeServicesParam}::boolean = TRUE
    ) x
    ORDER BY occurred_at DESC
  `;

  const { rows } = await pool.query(sql, params);

  const totals = rows.reduce(
    (acc, r) => {
      acc.total_selling += Number(r.total || 0);
      acc.total_capital += Number(r.capital_cost || 0);
      return acc;
    },
    { total_selling: 0, total_capital: 0 }
  );

  const total_selling = round2(totals.total_selling);
  const total_capital = round2(totals.total_capital);
  const total_gain = round2(total_selling - total_capital);
  const margin_percent = total_selling > 0 ? round2((total_gain / total_selling) * 100) : 0;

  return {
    rows,
    summary: { total_selling, total_capital, total_gain, margin_percent },
  };
}

module.exports = {
  getSalesSummary,
  getPaymentBreakdown,
  getTopProducts,
  getOverviewSummary,
  getDailyCashReconciliation,
  getProfitability,
};
