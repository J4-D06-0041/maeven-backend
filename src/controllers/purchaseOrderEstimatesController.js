const service = require('../services/purchaseOrderEstimateService');

async function list(req, res) {
  try {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const items = await service.listByPurchaseOrder(req.params.poId, { limit, offset });
    return res.json({ ok: true, data: items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function get(req, res) {
  try {
    const item = await service.getById(req.params.id);
    if (!item || item.purchase_order_id !== req.params.poId) return res.status(404).json({ ok: false, error: 'estimate not found' });
    return res.json({ ok: true, data: item });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function create(req, res) {
  try {
    const payload = req.body && (req.body.purchase_order_estimate || req.body.purchase_order_estimates) ? (req.body.purchase_order_estimate || req.body.purchase_order_estimates) : req.body;
    payload.purchase_order_id = req.params.poId;
    const created = await service.create(payload);
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
}

async function update(req, res) {
  try {
    const payload = req.body && (req.body.purchase_order_estimate || req.body.purchase_order_estimates) ? (req.body.purchase_order_estimate || req.body.purchase_order_estimates) : req.body;
    const updated = await service.update(req.params.id, payload);
    if (!updated) return res.status(404).json({ ok: false, error: 'estimate not found' });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
}

async function remove(req, res) {
  try {
    const removed = await service.remove(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'estimate not found' });
    return res.json({ ok: true, data: removed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = { list, get, create, update, remove };
