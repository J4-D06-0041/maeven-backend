const purchaseOrderItemsModel = require('../models/purchaseOrderItems');
const purchaseOrdersModel = require('../models/purchaseOrders');
const inventoryMovementsModel = require('../models/inventoryMovements');
const inventoriesModel = require('../models/inventories');
const { pool } = require('../db');

// purchase_orders.total_cost is a manually-entered estimate before receiving.
// Once items exist it should reflect what was actually received, so recompute
// it from the items every time they change instead of leaving it to drift.
async function recalculateTotalCost(purchaseOrderId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(quantity * cost_price), 0) AS total FROM purchase_order_items WHERE purchase_order_id = $1',
    [purchaseOrderId]
  );
  await pool.query('UPDATE purchase_orders SET total_cost = $1 WHERE id = $2', [rows[0].total, purchaseOrderId]);
}

async function create(data) {
  const poId = data.purchase_order_id;
  if (!poId) throw new Error('purchase_order_id is required');
  const po = await purchaseOrdersModel.findById(poId);
  if (!po) throw new Error('purchase order not found');
  if (po.status !== 'received') throw new Error('purchase_order_items can only be added when purchase order status is "received"');

  const created = await purchaseOrderItemsModel.create(data);

  // After creating the item, create inventory movement and update inventory
  try {
    if (created && created.product_variant_id) {
      await inventoryMovementsModel.create({
        branch_id: po.branch_id,
        product_variant_id: created.product_variant_id,
        movement_type: 'restock',
        quantity: created.quantity,
        reference_type: 'purchase_order',
        reference_id: poId
      });

      await inventoriesModel.adjustQuantity(po.branch_id, created.product_variant_id, Number(created.quantity));
    }
    await recalculateTotalCost(poId);
  } catch (err) {
    console.error('Error processing inventory movement for created PO item', created && created.id, err.message || err);
    // Do not abort; item creation succeeded and we return it.
  }

  return created;
}

async function getById(id) {
  return purchaseOrderItemsModel.findById(id);
}

async function list(opts) {
  return purchaseOrderItemsModel.list(opts);
}

async function update(id, data) {
  const existing = await purchaseOrderItemsModel.findById(id);
  if (!existing) return null;

  const updated = await purchaseOrderItemsModel.edit(id, data);

  // Received items already contributed to stock at creation time, so an edit
  // here (quantity or variant change) needs to move stock by the delta rather
  // than leaving the original contribution untouched.
  try {
    const po = await purchaseOrdersModel.findById(existing.purchase_order_id);
    if (po && updated) {
      const oldVariant = existing.product_variant_id;
      const newVariant = updated.product_variant_id;
      const oldQty = Number(existing.quantity) || 0;
      const newQty = Number(updated.quantity) || 0;

      if (oldVariant && newVariant && oldVariant === newVariant) {
        const delta = newQty - oldQty;
        if (delta !== 0) {
          await inventoryMovementsModel.create({
            branch_id: po.branch_id,
            product_variant_id: newVariant,
            movement_type: 'adjustment',
            quantity: delta,
            reference_type: 'purchase_order',
            reference_id: po.id,
          });
          await inventoriesModel.adjustQuantity(po.branch_id, newVariant, delta);
        }
      } else {
        if (oldVariant) {
          await inventoryMovementsModel.create({
            branch_id: po.branch_id,
            product_variant_id: oldVariant,
            movement_type: 'adjustment',
            quantity: -oldQty,
            reference_type: 'purchase_order',
            reference_id: po.id,
          });
          await inventoriesModel.adjustQuantity(po.branch_id, oldVariant, -oldQty);
        }
        if (newVariant) {
          await inventoryMovementsModel.create({
            branch_id: po.branch_id,
            product_variant_id: newVariant,
            movement_type: 'adjustment',
            quantity: newQty,
            reference_type: 'purchase_order',
            reference_id: po.id,
          });
          await inventoriesModel.adjustQuantity(po.branch_id, newVariant, newQty);
        }
      }

      await recalculateTotalCost(po.id);
    }
  } catch (err) {
    console.error('Error adjusting stock for updated PO item', id, err.message || err);
  }

  return updated;
}

async function remove(id) {
  const existing = await purchaseOrderItemsModel.findById(id);
  const removed = await purchaseOrderItemsModel.remove(id);

  try {
    if (existing && existing.product_variant_id) {
      const po = await purchaseOrdersModel.findById(existing.purchase_order_id);
      if (po) {
        const qty = Number(existing.quantity) || 0;
        await inventoryMovementsModel.create({
          branch_id: po.branch_id,
          product_variant_id: existing.product_variant_id,
          movement_type: 'adjustment',
          quantity: -qty,
          reference_type: 'purchase_order',
          reference_id: po.id,
        });
        await inventoriesModel.adjustQuantity(po.branch_id, existing.product_variant_id, -qty);
        await recalculateTotalCost(po.id);
      }
    }
  } catch (err) {
    console.error('Error adjusting stock for removed PO item', id, err.message || err);
  }

  return removed;
}

module.exports = { create, getById, list, update, remove };
