const { insert, getById, getAll } = require('./_helpers');
const table = 'inventory_movements';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
}

async function list(opts) {
  return getAll(table, opts);
}

module.exports = { create, findById, list };
