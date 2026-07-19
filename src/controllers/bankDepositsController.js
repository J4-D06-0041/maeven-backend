const bankDepositsModel = require('../models/bankDeposits');

function assertAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'admin access required' });
    return false;
  }
  return true;
}

async function list(req, res) {
  try {
    if (!assertAdmin(req, res)) return;

    const rows = await bankDepositsModel.list({
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
      branch_id: req.query.branch_id || undefined,
      business_date: req.query.business_date || undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
      cash_reconciliation_id: req.query.cash_reconciliation_id || undefined,
    });

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function get(req, res) {
  try {
    if (!assertAdmin(req, res)) return;

    const row = await bankDepositsModel.findById(req.params.id);
    if (!row) {
      return res.status(404).json({ ok: false, error: 'bank deposit not found' });
    }
    return res.json({ ok: true, data: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function create(req, res) {
  try {
    if (!assertAdmin(req, res)) return;

    const payload = req.body && (req.body.bank_deposit || req.body.bank_deposits)
      ? (req.body.bank_deposit || req.body.bank_deposits)
      : req.body;

    const created = await bankDepositsModel.create({
      ...payload,
      deposited_by: req.user && req.user.id ? req.user.id : null,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    const text = String(err.message || '');
    const status = text.includes('not found') ? 404 : 400;
    return res.status(status).json({ ok: false, error: err.message });
  }
}

async function reverse(req, res) {
  try {
    if (!assertAdmin(req, res)) return;

    const payload = req.body && (req.body.bank_deposit_reversal || req.body.bank_deposit)
      ? (req.body.bank_deposit_reversal || req.body.bank_deposit)
      : req.body;

    const reversed = await bankDepositsModel.reverse({
      id: req.params.id,
      reversal_reason: payload && payload.reversal_reason,
      reference_number: payload && payload.reference_number,
      depositor_name: payload && payload.depositor_name,
      photo_proof_url: payload && payload.photo_proof_url,
      notes: payload && payload.notes,
      deposited_by: req.user && req.user.id ? req.user.id : null,
      deposited_at: payload && payload.deposited_at,
    });

    return res.status(201).json({ ok: true, data: reversed });
  } catch (err) {
    const text = String(err.message || '');
    const status = text.includes('not found') ? 404 : 400;
    return res.status(status).json({ ok: false, error: err.message });
  }
}

async function remove(req, res) {
  if (!assertAdmin(req, res)) return;
  return res.status(405).json({
    ok: false,
    error: 'deletion is disabled for audit trail; use /bank-deposits/:id/reverse instead',
  });
}

module.exports = {
  list,
  get,
  create,
  reverse,
  remove,
};