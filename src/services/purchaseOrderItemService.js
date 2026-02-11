const purchaseOrderItemsModel = require('../models/purchaseOrderItems');
const purchaseOrdersModel = require('../models/purchaseOrders');
const inventoryMovementsModel = require('../models/inventoryMovements');
const inventoriesModel = require('../models/inventories');

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

      const inv = await inventoriesModel.findByBranchAndVariant(po.branch_id, created.product_variant_id);
      if (inv) {
        await inventoriesModel.edit(inv.id, { quantity_on_hand: (inv.quantity_on_hand || 0) + Number(created.quantity) });
      } else {
        await inventoriesModel.create({ branch_id: po.branch_id, product_variant_id: created.product_variant_id, quantity_on_hand: Number(created.quantity) });
      }
    }
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
  return purchaseOrderItemsModel.edit(id, data);
}

async function remove(id) {
  return purchaseOrderItemsModel.remove(id);
}

module.exports = { create, getById, list, update, remove };
