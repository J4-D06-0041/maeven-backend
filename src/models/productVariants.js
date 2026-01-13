const { insert, update, deleteById } = require('./_helpers');
const { pool } = require('../db');

const table = 'product_variants';

async function create(data) {
  return insert(table, data);
}

// Return a single product variant joined with its product's photo_url
async function findById(id) {
  const text = `
    SELECT pv.*, p.photo_url, p.product_name
    FROM product_variants pv
    LEFT JOIN products p ON pv.product_id = p.id
    WHERE pv.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(text, [id]);
  const row = rows[0] || null;
  if (!row) return null;
  const product = { name: row.product_name || null, photo_url: row.photo_url || null };
  // remove flat fields to avoid duplication
  delete row.product_name;
  delete row.photo_url;
  return { ...row, product };
}

// list with optional where/params/limit/offset similar to other models
async function list({ limit = 100, offset = 0, where = '', params = [] } = {}) {
  let text = `
    SELECT pv.*, p.photo_url, p.product_name
    FROM product_variants pv
    LEFT JOIN products p ON pv.product_id = p.id
  `;
  if (where) text += ` WHERE ${where}`;
  // Order by created_at when available; else id
  text += ` ORDER BY pv.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const values = [...params, limit, offset];
  const { rows } = await pool.query(text, values);
  // map rows to nest product info
  return rows.map((r) => {
    const product = { name: r.product_name || null, photo_url: r.photo_url || null };
    delete r.product_name;
    delete r.photo_url;
    return { ...r, product };
  });
}

async function edit(id, data) {
  return update(table, id, data);
}

async function remove(id) {
  return deleteById(table, id);
}

module.exports = { create, findById, list, edit, remove };
