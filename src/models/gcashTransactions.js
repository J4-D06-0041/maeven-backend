const { insert, getById, getAll, pool } = require('./_helpers');

const table = 'gcash_transactions';

async function create(data) {
  return insert(table, data);
}

async function createWithClient(data, client = pool) {
  const keys = Object.keys(data || {});
  if (!keys.length) throw new Error('No data provided for insert');

  const cols = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => data[k]);

  const text = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
  const { rows } = await client.query(text, values);
  return rows[0] || null;
}

async function findById(id) {
  return getById(table, id);
}

async function list(opts) {
  return getAll(table, opts);
}

module.exports = { create, createWithClient, findById, list };
