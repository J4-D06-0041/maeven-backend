const { pool } = require('../db');
const { validate } = require('./schemas');

async function hasColumn(table, column) {
  const text = `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`;
  const vals = [table, column];
  const { rows } = await pool.query(text, vals);
  return rows.length > 0;
}

async function getExistingColumns(table, columns = []) {
  if (!columns || !columns.length) return [];
  const text = `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = ANY($2)`;
  const vals = [table, columns];
  const { rows } = await pool.query(text, vals);
  return rows.map((r) => r.column_name);
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

  // Filter out any keys that are not actual columns in the DB table
  const existing = await getExistingColumns(table, keys);
  const validKeys = keys.filter((k) => existing.includes(k));
  if (!validKeys.length) throw new Error('No valid columns provided for insert');

  const cols = validKeys.join(', ');
  const placeholders = validKeys.map((_, i) => `$${i + 1}`).join(', ');
  const values = validKeys.map((k) => data[k]);
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

  // Filter keys to only those that exist in the DB table
  const existing = await getExistingColumns(table, keys);
  const validKeys = keys.filter((k) => existing.includes(k));
  if (!validKeys.length) throw new Error('No valid columns provided for update');

  const set = validKeys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  const values = [id, ...validKeys.map((k) => data[k])];
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
