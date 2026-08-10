const { insert, getById, getAll, update, deleteById, pool } = require('./_helpers');
const table = 'inventories';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
}

async function findByBranchAndVariant(branchId, variantId) {
  const { rows } = await pool.query(
    'SELECT * FROM inventories WHERE branch_id=$1 AND product_variant_id=$2 LIMIT 1',
    [branchId, variantId]
  );
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

// Apply a signed quantity change for a branch+variant, floored at 0 so sales
// and adjustments can never push stock negative. Only creates a new row when
// the delta is positive (a negative delta with no existing row is a no-op).
async function adjustQuantity(branchId, productVariantId, delta) {
  if (!productVariantId || !delta) return null;
  const existing = await findByBranchAndVariant(branchId, productVariantId);
  if (existing) {
    const newQty = Math.max(0, (existing.quantity_on_hand || 0) + delta);
    return edit(existing.id, { quantity_on_hand: newQty });
  }
  if (delta > 0) {
    return create({ branch_id: branchId, product_variant_id: productVariantId, quantity_on_hand: delta });
  }
  return null;
}

module.exports = { create, findById, findByBranchAndVariant, list, edit, remove, adjustQuantity };
