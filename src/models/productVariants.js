const { insert, update } = require('./_helpers');
const { pool } = require('../db');

const table = 'product_variants';

async function create(data) {
  return insert(table, data);
}

// Return a single product variant joined with its product's photo_url
async function findById(id) {
  const text = `
    SELECT pv.*, p.product_name
    FROM product_variants pv
    LEFT JOIN products p ON pv.product_id = p.id
    WHERE pv.id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(text, [id]);
  const row = rows[0] || null;
  if (!row) return null;
  const product = { name: row.product_name || null };
  // remove flat product fields to avoid duplication; variant's own photo_url remains on the variant
  delete row.product_name;
  return { ...row, product };
}

// list with optional where/params/limit/offset similar to other models
async function list({ limit = 100, offset = 0, where = '', params = [] } = {}) {
  let text = `
    SELECT pv.*, p.product_name
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
    const product = { name: r.product_name || null };
    delete r.product_name;
    return { ...r, product };
  });
}

async function edit(id, data) {
  return update(table, id, data);
}

async function remove(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
    const variant = existing.rows[0] || null;
    if (!variant) {
      await client.query('ROLLBACK');
      return null;
    }

    const refs = await client.query(
      `SELECT 1 FROM inventory_movements WHERE product_variant_id = $1 LIMIT 1`,
      [id]
    );

    if (refs.rowCount > 0) {
      const deactivated = await client.query(
        `UPDATE ${table} SET is_active = FALSE WHERE id = $1 RETURNING *`,
        [id]
      );
      await client.query('COMMIT');
      return deactivated.rows[0] || null;
    }

    const deleted = await client.query(`DELETE FROM ${table} WHERE id = $1 RETURNING *`, [id]);
    await client.query('COMMIT');
    return deleted.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { create, findById, list, edit, remove };
