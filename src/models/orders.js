const { insert, getById, getAll, update, deleteById, pool } = require('./_helpers');
const table = 'orders';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
}

async function findByOrderNumber(orderNumber) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE order_number=$1 LIMIT 1', [orderNumber]);
  return rows[0] || null;
}

async function list(opts) {
  return getAll(table, opts);
}

async function edit(id, data) {
  return update(table, id, data);
}

async function remove(id) {
  return deleteById(table, id);
}

module.exports = { create, findById, findByOrderNumber, list, edit, remove };
