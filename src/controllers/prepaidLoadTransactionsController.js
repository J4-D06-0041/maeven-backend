const service = require('../services/prepaidLoadTransactionService');

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
    if (!item) return res.status(404).json({ ok: false, error: 'prepaid load transaction not found' });
    return res.json({ ok: true, data: item });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function create(req, res) {
  try {
    const payload = req.body && (req.body.prepaid_load_transaction || req.body.prepaid_load_transactions)
      ? (req.body.prepaid_load_transaction || req.body.prepaid_load_transactions)
      : req.body;

    const created = await service.create(payload, req.user && req.user.id);
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
}

module.exports = { list, get, create };
