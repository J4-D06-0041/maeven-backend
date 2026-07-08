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

module.exports = { salesSummary, overviewSummary, paymentBreakdown, topProducts };
