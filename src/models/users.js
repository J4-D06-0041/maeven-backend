const { insert, getById, getAll, update, deleteById } = require('./_helpers');
const bcrypt = require('bcryptjs');
const table = 'users';

async function create(data) {
  // If a plain `password` is provided, hash it and store as `password_hash`.
  const { password, ...rest } = data || {};
  const payload = { ...rest };
  if (password) {
    const salt = await bcrypt.genSalt(10);
    payload.password_hash = await bcrypt.hash(password, salt);
  }
  return insert(table, payload);
}

async function findById(id) {
  return getById(table, id);
}

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
  return getAll(table, opts);
}

async function edit(id, data) {
  return update(table, id, data);
}

async function remove(id) {
  return deleteById(table, id);
}

module.exports = { create, findById, findByPhone, findByEmail, list, edit, remove };
