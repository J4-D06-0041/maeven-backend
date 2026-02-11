const purchaseOrdersModel = require('../models/purchaseOrders');
const purchaseOrderItemsModel = require('../models/purchaseOrderItems');
const inventoryMovementsModel = require('../models/inventoryMovements');
const inventoriesModel = require('../models/inventories');
const { pool } = require('../db');

async function create(data) {
  return purchaseOrdersModel.create(data);
}

async function getById(id) {
  return purchaseOrdersModel.findById(id);
}

async function list(opts) {
  return purchaseOrdersModel.list(opts);
}

async function update(id, data) {
  // Load existing PO
  const existing = await purchaseOrdersModel.findById(id);
  if (!existing) return null;

  const prevStatus = existing.status;
  const newStatus = data && data.status ? data.status : prevStatus;

  // If transitioning to 'received' from something else, perform inventory movements
  if (prevStatus !== 'received' && newStatus === 'received') {
    // Fetch all items for this PO
    const items = await purchaseOrderItemsModel.list({ where: 'purchase_order_id = $1', params: [id], limit: 1000, offset: 0 });
    // For each item create inventory movement and update/create inventory record
    for (const it of items) {
      if (!it.product_variant_id) continue; // skip non-variant items
      try {
        await inventoryMovementsModel.create({
          branch_id: existing.branch_id,
          product_variant_id: it.product_variant_id,
          movement_type: 'restock',
          quantity: it.quantity,
          reference_type: 'purchase_order',
          reference_id: id
        });

        const inv = await inventoriesModel.findByBranchAndVariant(existing.branch_id, it.product_variant_id);
        if (inv) {
          await inventoriesModel.edit(inv.id, { quantity_on_hand: (inv.quantity_on_hand || 0) + Number(it.quantity) });
        } else {
          await inventoriesModel.create({ branch_id: existing.branch_id, product_variant_id: it.product_variant_id, quantity_on_hand: Number(it.quantity) });
        }
      } catch (err) {
        // Log and continue; do not abort entire operation for one failed item
        console.error('Error processing inventory movement for PO item', it.id, err.message || err);
      }
    }
  }

  return purchaseOrdersModel.edit(id, data);
}

async function remove(id) {
  return purchaseOrdersModel.remove(id);
}

module.exports = { create, getById, list, update, remove };

async function getVariance(purchaseOrderId) {
  // estimated total
  const estRes = await pool.query('SELECT COALESCE(SUM(estimated_total_cost),0) AS estimated_total FROM purchase_order_estimates WHERE purchase_order_id = $1', [purchaseOrderId]);
  const estimated_total = estRes.rows[0] ? Number(estRes.rows[0].estimated_total) : 0;

  // actual total from items (quantity * cost_price)
  const actRes = await pool.query('SELECT COALESCE(SUM(quantity * cost_price),0) AS actual_total FROM purchase_order_items WHERE purchase_order_id = $1', [purchaseOrderId]);
  const actual_total = actRes.rows[0] ? Number(actRes.rows[0].actual_total) : 0;

  return { purchase_order_id: purchaseOrderId, estimated_total, actual_total, variance: actual_total - estimated_total };
}

module.exports.getVariance = getVariance;
