const { pool } = require('../db');

async function getVariance(purchaseOrderId) {
  // estimated total
  const estRes = await pool.query('SELECT COALESCE(SUM(estimated_total_cost),0) AS estimated_total FROM purchase_order_estimates WHERE purchase_order_id = $1', [purchaseOrderId]);
  const estimated_total = estRes.rows[0] ? Number(estRes.rows[0].estimated_total) : 0;

  // actual total from items (quantity * cost_price)
  const actRes = await pool.query('SELECT COALESCE(SUM(quantity * cost_price),0) AS actual_total FROM purchase_order_items WHERE purchase_order_id = $1', [purchaseOrderId]);
  const actual_total = actRes.rows[0] ? Number(actRes.rows[0].actual_total) : 0;

  return { purchase_order_id: purchaseOrderId, estimated_total, actual_total, variance: actual_total - estimated_total };
}

module.exports = { getVariance };
