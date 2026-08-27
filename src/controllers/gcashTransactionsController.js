const service = require('../services/gcashTransactionService');

// Admin gating for the destructive route lives in routes/api.js.
async function list(req, res) {
  try {
    const items = await service.list({
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
    });
    return res.json({ ok: true, data: items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function get(req, res) {
  try {
    const item = await service.getById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'gcash transaction not found' });
    return res.json({ ok: true, data: item });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function create(req, res) {
  try {
    const payload = req.body && (req.body.gcash_transaction || req.body.gcash_transactions)
      ? (req.body.gcash_transaction || req.body.gcash_transactions)
      : req.body;

    const created = await service.create(payload, req.user && req.user.id);
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
}

async function remove(req, res) {
  try {
    const removed = await service.remove(req.params.id);
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'gcash transaction not found' });
    }

    return res.json({ ok: true, data: removed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = { list, get, create, remove };
