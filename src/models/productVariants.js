const { insert, getById, getAll, update, deleteById } = require('./_helpers');
const table = 'product_variants';

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

module.exports = { create, findById, list, edit, remove };
