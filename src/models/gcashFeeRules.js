const { insert, getById, getAll, update, deleteById, pool } = require('./_helpers');

const table = 'gcash_fee_rules';

async function create(data) {
  return insert(table, data);
}

async function findById(id) {
  return getById(table, id);
}

async function list(opts) {
  return getAll(table, opts);
}

async function edit(id, data) {
  return update(table, id, data);
}

async function remove(id) {
  return deleteById(table, id);
}

async function findApplicable(serviceType, principalAmount, client = pool) {
  const text = `
    SELECT *
    FROM gcash_fee_rules
    WHERE service_type = $1
      AND is_active = TRUE
      AND $2::numeric >= min_amount
      AND (max_amount IS NULL OR $2::numeric <= max_amount)
      AND (effective_from IS NULL OR effective_from <= now())
      AND (effective_to IS NULL OR effective_to >= now())
    ORDER BY min_amount DESC, created_at DESC
    LIMIT 1
  `;
  const { rows } = await client.query(text, [serviceType, principalAmount]);
  return rows[0] || null;
}

async function findActiveOverlaps({ serviceType, minAmount, maxAmount = null, excludeId = null }, client = pool) {
  const text = `
    SELECT *
    FROM gcash_fee_rules
    WHERE service_type = $1
      AND is_active = TRUE
      AND ($4::uuid IS NULL OR id <> $4)
      AND NOT (
        (max_amount IS NOT NULL AND max_amount < $2::numeric)
        OR ($3::numeric IS NOT NULL AND $3::numeric < min_amount)
      )
    ORDER BY min_amount ASC, created_at ASC
  `;

  const { rows } = await client.query(text, [serviceType, minAmount, maxAmount, excludeId]);
  return rows;
}

module.exports = { create, findById, list, edit, remove, findApplicable, findActiveOverlaps };
