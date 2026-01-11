const { insert, getById, getAll, update, deleteById, pool } = require('./_helpers');
const table = 'inventories';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
}

async function findByBranchAndVariant(branchId, variantId) {
  const { rows } = await pool.query(
    'SELECT * FROM inventories WHERE branch_id=$1 AND product_variant_id=$2 LIMIT 1',
    [branchId, variantId]
  );
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

module.exports = { create, findById, findByBranchAndVariant, list, edit, remove };
