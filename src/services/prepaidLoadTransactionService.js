const { pool } = require('../db');
const prepaidLoadProductsModel = require('../models/prepaidLoadProducts');
const prepaidLoadTransactionsModel = require('../models/prepaidLoadTransactions');

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

function normalizeMobileNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('recipient_mobile_no is required');

  const digits = raw.replace(/\D/g, '');

  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;

  throw new Error('recipient_mobile_no must be a valid Philippine mobile number');
}

async function create(data, userId) {
  const payload = data || {};
  const productId = assertUuidOrNull(payload.product_id, 'product_id');
  if (!productId) throw new Error('product_id is required');

  const referenceNumber = String(payload.reference_number || '').trim();
  if (!referenceNumber) {
    throw new Error('reference_number is required');
  }

  const recipientMobileNo = normalizeMobileNumber(payload.recipient_mobile_no);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const product = await prepaidLoadProductsModel.findActiveById(productId, client);
    if (!product) {
      throw new Error('prepaid load product not found or inactive');
    }

    const faceValue = parsePositiveMoney(product.face_value, 'face_value');
    const markupAmount = roundMoney(Number(product.markup_amount || 0));
    const grossAmount = roundMoney(faceValue + markupAmount);

    // Prepaid load sales are cash inflow to the register.
    const cashImpact = grossAmount;

    const created = await prepaidLoadTransactionsModel.createWithClient({
      order_id: assertUuidOrNull(payload.order_id, 'order_id'),
      branch_id: assertUuidOrNull(payload.branch_id, 'branch_id'),
      customer_id: assertUuidOrNull(payload.customer_id, 'customer_id'),
      recipient_mobile_no: recipientMobileNo,
      carrier: product.carrier,
      product_id: product.id,
      face_value: faceValue,
      markup_amount: markupAmount,
      gross_amount: grossAmount,
      cash_impact: cashImpact,
      reference_number: referenceNumber,
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
  return prepaidLoadTransactionsModel.findById(id);
}

async function list(opts) {
  return prepaidLoadTransactionsModel.list(opts);
}

module.exports = { create, getById, list };
