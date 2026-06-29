const gcashFeeRulesModel = require('../models/gcashFeeRules');

const VALID_SERVICE_TYPES = ['cash_in', 'cash_out'];

function parseMoney(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  return Number(n.toFixed(2));
}

function validateRange({ serviceType, minAmount, maxAmount }) {
  if (!VALID_SERVICE_TYPES.includes(serviceType)) {
    throw new Error('service_type must be one of: cash_in, cash_out');
  }

  if (minAmount < 0) {
    throw new Error('min_amount must be greater than or equal to 0');
  }

  if (maxAmount !== null && maxAmount < minAmount) {
    throw new Error('max_amount must be greater than or equal to min_amount');
  }
}

async function assertNoActiveOverlap({ serviceType, minAmount, maxAmount, excludeId = null }) {
  const overlaps = await gcashFeeRulesModel.findActiveOverlaps({
    serviceType,
    minAmount,
    maxAmount,
    excludeId,
  });

  if (overlaps.length > 0) {
    const existing = overlaps[0];
    const existingMax = existing.max_amount === null || existing.max_amount === undefined ? 'infinity' : existing.max_amount;
    throw new Error(`fee range overlaps existing active rule (${existing.min_amount} - ${existingMax})`);
  }
}

async function create(data) {
  const payload = data || {};

  const serviceType = payload.service_type;
  const minAmount = parseMoney(payload.min_amount, 'min_amount');
  const maxAmount = payload.max_amount === null || payload.max_amount === undefined || payload.max_amount === ''
    ? null
    : parseMoney(payload.max_amount, 'max_amount');
  const feeAmount = parseMoney(payload.fee_amount, 'fee_amount');

  validateRange({ serviceType, minAmount, maxAmount });

  const isActive = payload.is_active === undefined ? true : Boolean(payload.is_active);
  if (isActive) {
    await assertNoActiveOverlap({ serviceType, minAmount, maxAmount });
  }

  return gcashFeeRulesModel.create({
    ...payload,
    service_type: serviceType,
    min_amount: minAmount,
    max_amount: maxAmount,
    fee_amount: feeAmount,
    is_active: isActive,
  });
}

async function getById(id) {
  return gcashFeeRulesModel.findById(id);
}

async function list(opts) {
  return gcashFeeRulesModel.list(opts);
}

async function update(id, data) {
  const existing = await gcashFeeRulesModel.findById(id);
  if (!existing) return null;

  const payload = data || {};
  const merged = { ...existing, ...payload };

  const serviceType = merged.service_type;
  const minAmount = parseMoney(merged.min_amount, 'min_amount');
  const maxAmount = merged.max_amount === null || merged.max_amount === undefined || merged.max_amount === ''
    ? null
    : parseMoney(merged.max_amount, 'max_amount');
  const feeAmount = parseMoney(merged.fee_amount, 'fee_amount');

  validateRange({ serviceType, minAmount, maxAmount });

  const isActive = merged.is_active === undefined ? true : Boolean(merged.is_active);
  if (isActive) {
    await assertNoActiveOverlap({ serviceType, minAmount, maxAmount, excludeId: id });
  }

  return gcashFeeRulesModel.edit(id, {
    ...payload,
    service_type: serviceType,
    min_amount: minAmount,
    max_amount: maxAmount,
    fee_amount: feeAmount,
    is_active: isActive,
  });
}

async function remove(id) {
  return gcashFeeRulesModel.remove(id);
}

module.exports = { create, getById, list, update, remove };
