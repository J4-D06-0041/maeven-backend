const { pool } = require('../db');
const gcashFeeRulesModel = require('../models/gcashFeeRules');
const gcashTransactionsModel = require('../models/gcashTransactions');

const VALID_SERVICE_TYPES = ['cash_in', 'cash_out'];

function parsePositiveMoney(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return n;
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function assertUuidOrNull(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(String(value))) {
    throw new Error(`${fieldName} must be a UUID`);
  }
  return value;
}

async function create(data, userId) {
  const payload = data || {};
  const serviceType = payload.service_type;
  if (!VALID_SERVICE_TYPES.includes(serviceType)) {
    throw new Error('service_type must be one of: cash_in, cash_out');
  }

  const referenceNumber = String(payload.reference_number || '').trim();
  if (!referenceNumber) {
    throw new Error('reference_number is required');
  }

  const principalAmount = parsePositiveMoney(payload.principal_amount, 'principal_amount');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const feeRule = await gcashFeeRulesModel.findApplicable(serviceType, principalAmount, client);
    if (!feeRule) {
      throw new Error(`No active fee rule found for ${serviceType} at amount ${principalAmount}`);
    }

    const feeAmount = roundMoney(Number(feeRule.fee_amount || 0));
    const grossAmount = roundMoney(principalAmount + feeAmount);

    // Cash-out affects register cash as: fee in minus principal out.
    const cashImpact = serviceType === 'cash_in'
      ? grossAmount
      : roundMoney(feeAmount - principalAmount);

    const created = await gcashTransactionsModel.createWithClient({
      order_id: assertUuidOrNull(payload.order_id, 'order_id'),
      branch_id: assertUuidOrNull(payload.branch_id, 'branch_id'),
      customer_id: assertUuidOrNull(payload.customer_id, 'customer_id'),
      service_type: serviceType,
      principal_amount: principalAmount,
      fee_amount: feeAmount,
      gross_amount: grossAmount,
      cash_impact: cashImpact,
      reference_number: referenceNumber,
      fee_rule_id: feeRule.id,
      received_by: assertUuidOrNull(userId || payload.received_by, 'received_by'),
      notes: payload.notes ? String(payload.notes) : null,
    }, client);

    await client.query('COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === '23505') {
      throw new Error('reference_number already exists');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getById(id) {
  return gcashTransactionsModel.findById(id);
}

async function list(opts) {
  return gcashTransactionsModel.list(opts);
}

async function remove(id) {
  return gcashTransactionsModel.remove(id);
}

module.exports = { create, getById, list, remove };
