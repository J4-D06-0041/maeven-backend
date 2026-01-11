// Generic controller factory. Expects a service with create/getById/list/update/remove
function createController(service, resourceName = 'resource') {
  async function list(req, res) {
    try {
      const items = await service.list({ limit: Number(req.query.limit) || 100, offset: Number(req.query.offset) || 0 });
      return res.json({ ok: true, data: items });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async function get(req, res) {
    try {
      const item = await service.getById(req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: `${resourceName} not found` });
      return res.json({ ok: true, data: item });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async function create(req, res) {
    try {
      // Allow payloads wrapped by resource name or its plural (e.g. {"customer": {...}} or {"customers": {...}})
      const payload = req.body && (req.body[resourceName] || req.body[`${resourceName}s`]) ? (req.body[resourceName] || req.body[`${resourceName}s`]) : req.body;
      const created = await service.create(payload);
      return res.status(201).json({ ok: true, data: created });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async function update(req, res) {
    try {
      const payload = req.body && (req.body[resourceName] || req.body[`${resourceName}s`]) ? (req.body[resourceName] || req.body[`${resourceName}s`]) : req.body;
      const updated = await service.update(req.params.id, payload);
      if (!updated) return res.status(404).json({ ok: false, error: `${resourceName} not found` });
      return res.json({ ok: true, data: updated });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async function remove(req, res) {
    try {
      const removed = await service.remove(req.params.id);
      if (!removed) return res.status(404).json({ ok: false, error: `${resourceName} not found` });
      return res.json({ ok: true, data: removed });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return { list, get, create, update, remove };
}

module.exports = { createController };
