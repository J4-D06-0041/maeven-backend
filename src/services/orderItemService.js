const orderItemsModel = require('../models/orderItems');
const ordersModel = require('../models/orders');
const inventoryMovementsModel = require('../models/inventoryMovements');
const inventoriesModel = require('../models/inventories');

async function create(data) {
  const orderId = data.order_id;
  if (!orderId) throw new Error('order_id is required');
  const order = await ordersModel.findById(orderId);
  if (!order) throw new Error('order not found');

  const created = await orderItemsModel.create(data);

  // Record the sale movement and deduct stock at the order's branch. Errors
  // here are logged and swallowed so a stock hiccup never blocks the sale
  // itself, matching how purchase-order-item receiving handles this.
  try {
    if (created && created.product_variant_id && order.branch_id) {
      const quantity = Number(created.quantity) || 0;
      await inventoryMovementsModel.create({
        branch_id: order.branch_id,
        product_variant_id: created.product_variant_id,
        movement_type: 'sale',
        quantity,
        reference_type: 'order',
        reference_id: orderId,
      });

      await inventoriesModel.adjustQuantity(order.branch_id, created.product_variant_id, -quantity);
    }
  } catch (err) {
    console.error('Error processing inventory movement for created order item', created && created.id, err.message || err);
  }

  return created;
}

async function getById(id) {
  return orderItemsModel.findById(id);
}

async function list(opts) {
  return orderItemsModel.list(opts);
}

async function update(id, data) {
  return orderItemsModel.edit(id, data);
}

async function remove(id) {
  return orderItemsModel.remove(id);
}

module.exports = { create, getById, list, update, remove };
