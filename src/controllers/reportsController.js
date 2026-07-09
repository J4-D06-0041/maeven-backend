const reportsModel = require('../models/reports');

const VALID_PERIODS = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];

function parseDateRange(query) {
  const { from, to } = query;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return { error: '`from` must be a date in YYYY-MM-DD format' };
  }
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { error: '`to` must be a date in YYYY-MM-DD format' };
  }
  if (from && to && from > to) {
    return { error: '`from` must not be after `to`' };
  }
  return { from: from || undefined, to: to || undefined };
}

async function salesSummary(req, res) {
  try {
    const period = (req.query.period || 'daily').toLowerCase();
    if (!VALID_PERIODS.includes(period)) {
      return res.status(400).json({ ok: false, error: `Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}` });
    }
    if (period === 'custom' && (!req.query.from || !req.query.to)) {
      return res.status(400).json({ ok: false, error: '`from` and `to` are required when period is "custom"' });
    }

    const dates = parseDateRange(req.query);
    if (dates.error) return res.status(400).json({ ok: false, error: dates.error });

    const data = await reportsModel.getSalesSummary({
      period,
      from: dates.from,
      to: dates.to,
      branch_id: req.query.branch_id || undefined,
      sales_channel_id: req.query.sales_channel_id || undefined,
    });

    return res.json({ ok: true, period, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function overviewSummary(req, res) {
  try {
    const dates = parseDateRange(req.query);
    if (dates.error) return res.status(400).json({ ok: false, error: dates.error });

    const data = await reportsModel.getOverviewSummary({
      from: dates.from,
      to: dates.to,
      branch_id: req.query.branch_id || undefined,
      sales_channel_id: req.query.sales_channel_id || undefined,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function paymentBreakdown(req, res) {
  try {
    const dates = parseDateRange(req.query);
    if (dates.error) return res.status(400).json({ ok: false, error: dates.error });

    const data = await reportsModel.getPaymentBreakdown({
      from: dates.from,
      to: dates.to,
      branch_id: req.query.branch_id || undefined,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function topProducts(req, res) {
  try {
    const dates = parseDateRange(req.query);
    if (dates.error) return res.status(400).json({ ok: false, error: dates.error });

    const limit = Math.min(Number(req.query.limit) || 10, 100);

    const data = await reportsModel.getTopProducts({
      from: dates.from,
      to: dates.to,
      branch_id: req.query.branch_id || undefined,
      limit,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function dailyCashReconciliation(req, res) {
  try {
    const branch_id = req.query.branch_id;
    const business_date = req.query.business_date;

    if (!branch_id) {
      return res.status(400).json({ ok: false, error: 'branch_id is required' });
    }
    if (!business_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(business_date))) {
      return res.status(400).json({ ok: false, error: 'business_date is required in YYYY-MM-DD format' });
    }

    const data = await reportsModel.getDailyCashReconciliation({
      branch_id,
      business_date,
    });

    if (!data) {
      return res.status(404).json({ ok: false, error: 'cash reconciliation report not found for branch/date' });
    }

    const cashSales = Number(data.cash_sales_amount || 0);
    const otherNet = Number(data.other_cash_impact_amount || 0);
    const cashIn = Number(data.gcash_cash_in_total || 0);
    const cashOut = Number(data.gcash_cash_out_total || 0);
    const expected = Number(data.expected_cash_on_hand || 0);
    const actual = Number(data.actual_cash_on_hand || 0);
    const variance = Number(data.variance_amount || 0);

    const withAuditSummary = {
      ...data,
      audit_summary: {
        cash_sales_amount: Number(cashSales.toFixed(2)),
        gcash_cash_in_total: Number(cashIn.toFixed(2)),
        gcash_cash_out_total: Number(cashOut.toFixed(2)),
        net_other_cash_impact_amount: Number(otherNet.toFixed(2)),
        total_cash_inflows: Number((cashSales + cashIn).toFixed(2)),
        total_cash_outflows: Number(cashOut.toFixed(2)),
        expected_cash_on_hand: Number(expected.toFixed(2)),
        actual_cash_on_hand: Number(actual.toFixed(2)),
        variance_amount: Number(variance.toFixed(2)),
        is_short: Boolean(data.is_short),
      },
    };

    return res.json({ ok: true, data: withAuditSummary });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = { salesSummary, overviewSummary, paymentBreakdown, topProducts, dailyCashReconciliation };
