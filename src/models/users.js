const { insert, getById, getAll, update, deleteById } = require('./_helpers');
const bcrypt = require('bcryptjs');
const table = 'users';

// Everything on `users` except `password_hash`. The generic helpers do
// `SELECT *`, which handed bcrypt hashes to every caller of list/findById;
// these paths feed HTTP responses, so the projection is the safety net.
const SAFE_COLUMNS = [
  'id', 'full_name', 'phone', 'email', 'role', 'branch_id', 'is_active', 'created_at',
];

// `password_hash` is never accepted from a client -- only a plain `password`,
// which is hashed here. Otherwise a caller could set the stored hash directly
// and log in as anyone.
function stripHash(data) {
  const { password, password_hash, ...rest } = data || {};
  return { password, rest };
}

async function create(data) {
  const { password, rest } = stripHash(data);
  const payload = { ...rest };
  if (password) {
    const salt = await bcrypt.genSalt(10);
    payload.password_hash = await bcrypt.hash(password, salt);
  }
  return insert(table, payload, { returning: SAFE_COLUMNS });
}

async function findById(id) {
  return getById(table, id, { columns: SAFE_COLUMNS });
}

// findByPhone / findByEmail intentionally select every column, including
// `password_hash` -- the login route needs it to compare against. They are not
// reachable from any route, so the hash never leaves the process here.
async function findByPhone(phone) {
  const { pool } = require('./_helpers');
  const { rows } = await pool.query('SELECT * FROM users WHERE phone=$1 LIMIT 1', [phone]);
  return rows[0] || null;
}

async function findByEmail(email) {
  const { pool } = require('./_helpers');
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1 LIMIT 1', [email]);
  return rows[0] || null;
}

async function list(opts) {
  return getAll(table, { ...opts, columns: SAFE_COLUMNS });
}

async function edit(id, data) {
  const { password, rest } = stripHash(data);
  const payload = { ...rest };
  if (password) {
    const salt = await bcrypt.genSalt(10);
    payload.password_hash = await bcrypt.hash(password, salt);
  }
  return update(table, id, payload, { returning: SAFE_COLUMNS });
}

async function remove(id) {
  return deleteById(table, id, { returning: SAFE_COLUMNS });
}

module.exports = { create, findById, findByPhone, findByEmail, list, edit, remove };
