const { insert, getById, getAll, update, deleteById, pool } = require('./_helpers');

const table = 'prepaid_load_products';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
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

async function findActiveById(id, client = pool) {
  const text = `
    SELECT *
    FROM prepaid_load_products
    WHERE id = $1
      AND is_active = TRUE
    LIMIT 1
  `;
  const { rows } = await client.query(text, [id]);
  return rows[0] || null;
}

module.exports = { create, findById, list, edit, remove, findActiveById };
