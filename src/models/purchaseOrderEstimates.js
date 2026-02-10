const { insert, getById, getAll, update, deleteById } = require('./_helpers');
const table = 'purchase_order_estimates';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
}

async function list(opts) {
  return getAll(table, opts);
}

async function listByPurchaseOrder(purchaseOrderId, opts = {}) {
  const where = 'purchase_order_id = $1';
  const params = [purchaseOrderId];
  return getAll(table, { ...opts, where, params });
}

async function edit(id, data) {
  return update(table, id, data);
}

async function remove(id) {
  return deleteById(table, id);
}

module.exports = { create, findById, list, listByPurchaseOrder, edit, remove };
