const { insert, getById, getAll, update } = require('./_helpers');
const { pool } = require('../db');
const table = 'products';

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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
    const product = existing.rows[0] || null;
    if (!product) {
      await client.query('ROLLBACK');
      return null;
    }

    // If a product has variants referenced by inventory history, preserve history
    // by archiving the product and deactivating variants instead of hard-deleting.
    const refs = await client.query(
      `
      SELECT 1
      FROM inventory_movements im
      JOIN product_variants pv ON pv.id = im.product_variant_id
      WHERE pv.product_id = $1
      LIMIT 1
      `,
      [id]
    );

    if (refs.rowCount > 0) {
      const archived = await client.query(
        `UPDATE ${table} SET status = 'archived' WHERE id = $1 RETURNING *`,
        [id]
      );
      await client.query(`UPDATE product_variants SET is_active = FALSE WHERE product_id = $1`, [id]);
      await client.query('COMMIT');
      return archived.rows[0] || null;
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
