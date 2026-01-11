const { insert, getById, getAll, update, deleteById } = require('./_helpers');
const table = 'customers';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
}

async function findByPhone(phone) {
  const { pool } = require('./_helpers');
  const { rows } = await pool.query('SELECT * FROM customers WHERE phone=$1 LIMIT 1', [phone]);
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

module.exports = { create, findById, findByPhone, list, edit, remove };
