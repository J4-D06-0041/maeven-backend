const purchaseOrderEstimatesModel = require('../models/purchaseOrderEstimates');
const purchaseOrdersModel = require('../models/purchaseOrders');

async function create(data) {
  const poId = data.purchase_order_id;
  if (!poId) throw new Error('purchase_order_id is required');
  const po = await purchaseOrdersModel.findById(poId);
  if (!po) throw new Error('purchase order not found');
  if (po.status === 'received') throw new Error('Cannot add estimate to a received purchase order');
  return purchaseOrderEstimatesModel.create(data);
}

async function listByPurchaseOrder(purchaseOrderId, opts) {
  return purchaseOrderEstimatesModel.listByPurchaseOrder(purchaseOrderId, opts);
}

async function getById(id) {
  return purchaseOrderEstimatesModel.findById(id);
}

async function update(id, data) {
  const existing = await purchaseOrderEstimatesModel.findById(id);
  if (!existing) return null;
  const po = await purchaseOrdersModel.findById(existing.purchase_order_id);
  if (!po) throw new Error('purchase order not found');
  if (po.status === 'received') throw new Error('Cannot modify estimate for a received purchase order');
  return purchaseOrderEstimatesModel.edit(id, data);
}

async function remove(id) {
  const existing = await purchaseOrderEstimatesModel.findById(id);
  if (!existing) return null;
  const po = await purchaseOrdersModel.findById(existing.purchase_order_id);
  if (po && po.status === 'received') throw new Error('Cannot remove estimate from a received purchase order');
  return purchaseOrderEstimatesModel.remove(id);
}

module.exports = { create, listByPurchaseOrder, getById, update, remove };
