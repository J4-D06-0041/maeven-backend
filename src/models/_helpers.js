const { pool } = require('../db');
const { validate } = require('./schemas');

async function hasColumn(table, column) {
  const text = `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`;
  const vals = [table, column];
  const { rows } = await pool.query(text, vals);
  return rows.length > 0;
}

function _ensureDataProvided(defMessage) {
  if (!defMessage) throw new Error('No data provided');
}

async function insert(table, data) {
  _ensureDataProvided(data);
  // Validate required fields for insert
  try {
    validate(table, data, { requireAll: true });
  } catch (err) {
    throw err;
  }

  const keys = Object.keys(data || {});
  if (!keys.length) throw new Error('No data provided for insert');
  const cols = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => data[k]);
  const text = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
  const { rows } = await pool.query(text, values);
  return rows[0];
}

async function update(table, id, data) {
  const keys = Object.keys(data || {});
  if (!keys.length) throw new Error('No data provided for update');
  // Validate provided fields for update (do not require required fields)
  try {
    validate(table, data, { requireAll: false });
  } catch (err) {
    throw err;
  }

  const set = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  const values = [id, ...keys.map((k) => data[k])];
  const text = `UPDATE ${table} SET ${set} WHERE id=$1 RETURNING *`;
  const { rows } = await pool.query(text, values);
  return rows[0];
}

async function getById(table, id) {
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  return rows[0] || null;
}

async function deleteById(table, id) {
  const { rows } = await pool.query(`DELETE FROM ${table} WHERE id=$1 RETURNING *`, [id]);
  return rows[0] || null;
}

async function getAll(table, { limit = 100, offset = 0, where = '', params = [] } = {}) {
  let text = `SELECT * FROM ${table}`;
  if (where) text += ` WHERE ${where}`;

  // Order by created_at when available; otherwise fall back to id (newest first)
  const hasCreatedAt = await hasColumn(table, 'created_at');
  if (hasCreatedAt) {
    text += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  } else {
    text += ` ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  }

  const values = [...params, limit, offset];
  const { rows } = await pool.query(text, values);
  return rows;
}

module.exports = { pool, insert, update, getById, deleteById, getAll };
