const { insert, getById, getAll, update, deleteById } = require('./_helpers');
const { pool } = require('../db');
const table = 'purchase_orders';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
}

async function list(opts) {
  return getAll(table, opts);
}

async function listWithItemTotals({ limit = 100, offset = 0, where = '', params = [] } = {}) {
  // Build base query joining purchase_order_items and summing item totals per purchase order
  let text = `SELECT po.*, COALESCE(SUM(poi.quantity * poi.cost_price), 0) AS items_total, COUNT(poi.id) AS items_count
    FROM ${table} po
    LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id`;

  if (where) text += ` WHERE ${where}`;

  text += ` GROUP BY po.id ORDER BY po.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  const values = [...params, limit, offset];
  const { rows } = await pool.query(text, values);
  // Convert numeric items_total to number where possible
  return rows.map((r) => ({ ...r, items_total: r.items_total !== null ? Number(r.items_total) : 0 }));
}

async function edit(id, data) {
  return update(table, id, data);
}

async function remove(id) {
  return deleteById(table, id);
}

module.exports = { create, findById, list, listWithItemTotals, edit, remove };
