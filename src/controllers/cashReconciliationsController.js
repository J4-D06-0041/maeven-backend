const cashReconciliationsModel = require('../models/cashReconciliations');

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(input) {
  if (!input) {
    return new Date().toISOString().slice(0, 10);
  }
  return String(input);
}

function normalizeBreakdown(value) {
  if (!Array.isArray(value)) {
    throw new Error('cash breakdown must be an array of { denomination, quantity }');
  }

  const normalized = value.map((item) => {
    const denomination = Number(item && item.denomination);
    const quantity = Number(item && item.quantity);

    if (Number.isNaN(denomination) || denomination <= 0) {
      throw new Error('each denomination must be a positive number');
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error('each quantity must be a non-negative integer');
    }

    return {
      denomination: Number(denomination.toFixed(2)),
      quantity,
      amount: Number((denomination * quantity).toFixed(2)),
    };
  });

  normalized.sort((a, b) => b.denomination - a.denomination);
  return normalized;
}

function totalFromBreakdown(breakdown) {
  return Number(
    breakdown
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      .toFixed(2)
  );
}

function buildAuditSummary(data) {
  const cashSales = Number(data.cash_sales_amount || 0);
  const otherNet = Number(data.other_cash_impact_amount || 0);
  const cashIn = Number(data.gcash_cash_in_total || 0);
  const cashOut = Number(data.gcash_cash_out_total || 0);
  const prepaidLoadTotal = Number(data.prepaid_load_total || 0);
  const expected = Number(data.expected_cash_on_hand || 0);
  const actual = Number(data.actual_cash_on_hand || 0);
  const variance = Number(data.variance_amount || 0);

  return {
    cash_sales_amount: Number(cashSales.toFixed(2)),
    gcash_cash_in_total: Number(cashIn.toFixed(2)),
    gcash_cash_out_total: Number(cashOut.toFixed(2)),
    prepaid_load_total: Number(prepaidLoadTotal.toFixed(2)),
    net_other_cash_impact_amount: Number(otherNet.toFixed(2)),
    total_cash_inflows: Number((cashSales + cashIn).toFixed(2)),
    total_cash_outflows: Number(cashOut.toFixed(2)),
    expected_cash_on_hand: Number(expected.toFixed(2)),
    actual_cash_on_hand: Number(actual.toFixed(2)),
    variance_amount: Number(variance.toFixed(2)),
    is_short: Boolean(data.is_short),
  };
}

async function open(req, res) {
  try {
    const branch_id = req.body.branch_id;
    const business_date = normalizeDate(req.body.business_date);
    const notes = req.body.notes || null;

    if (!branch_id) {
      return res.status(400).json({ ok: false, error: 'branch_id is required' });
    }
    if (!dateRegex.test(business_date)) {
      return res.status(400).json({ ok: false, error: 'business_date must be in YYYY-MM-DD format' });
    }

    const openingBreakdown = normalizeBreakdown(req.body.opening_cash_breakdown || []);
    const openingTotal = totalFromBreakdown(openingBreakdown);

    const row = await cashReconciliationsModel.openDay({
      branch_id,
      business_date,
      opening_cash_breakdown: openingBreakdown,
      opening_cash_total: openingTotal,
      notes,
      opened_by: req.user && req.user.id ? req.user.id : null,
    });

    return res.status(201).json({ ok: true, data: row });
  } catch (err) {
    if (String(err.message || '').includes('ux_cash_reconciliations_branch_date') || String(err.message || '').includes('cash_reconciliations_branch_id_business_date_key')) {
      return res.status(409).json({ ok: false, error: 'opening cash for this branch and date already exists' });
    }
    return res.status(400).json({ ok: false, error: err.message });
  }
}

async function close(req, res) {
  try {
    const closingBreakdown = normalizeBreakdown(req.body.closing_cash_breakdown || []);
    const closingTotal = totalFromBreakdown(closingBreakdown);

    const row = await cashReconciliationsModel.closeDay({
      id: req.params.id,
      closing_cash_breakdown: closingBreakdown,
      closing_cash_total: closingTotal,
      closed_by: req.user && req.user.id ? req.user.id : null,
      notes: req.body.notes || null,
    });

    return res.json({ ok: true, data: row });
  } catch (err) {
    if (String(err.message || '').includes('not found')) {
      return res.status(404).json({ ok: false, error: err.message });
    }
    return res.status(400).json({ ok: false, error: err.message });
  }
}

async function upsertOpen(req, res) {
  try {
    const branch_id = req.body.branch_id;
    const business_date = normalizeDate(req.body.business_date);
    const notes = req.body.notes || null;

    if (!branch_id) {
      return res.status(400).json({ ok: false, error: 'branch_id is required' });
    }
    if (!dateRegex.test(business_date)) {
      return res.status(400).json({ ok: false, error: 'business_date must be in YYYY-MM-DD format' });
    }

    const openingBreakdown = normalizeBreakdown(req.body.opening_cash_breakdown || []);
    const openingTotal = totalFromBreakdown(openingBreakdown);

    const row = await cashReconciliationsModel.upsertOpeningDay({
      branch_id,
      business_date,
      opening_cash_breakdown: openingBreakdown,
      opening_cash_total: openingTotal,
      notes,
      opened_by: req.user && req.user.id ? req.user.id : null,
    });

    return res.json({ ok: true, data: row });
  } catch (err) {
    if (String(err.message || '').includes('already closed')) {
      return res.status(409).json({ ok: false, error: err.message });
    }
    return res.status(400).json({ ok: false, error: err.message });
  }
}

async function list(req, res) {
  try {
    const data = await cashReconciliationsModel.list({
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
      branch_id: req.query.branch_id || undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
    });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function get(req, res) {
  try {
    const row = await cashReconciliationsModel.findById(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'cash reconciliation not found' });
    const data = {
      ...row,
      audit_summary: buildAuditSummary(row),
    };
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function remove(req, res) {
  try {
    const row = await cashReconciliationsModel.deleteById(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'cash reconciliation not found' });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = {
  open,
  upsertOpen,
  close,
  list,
  get,
  remove,
};
