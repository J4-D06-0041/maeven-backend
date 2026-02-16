// Simple schema definitions for basic validation before DB inserts/updates.
// Each field can set: type, required, allowNull, values (for enum).

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schemas = {
  branches: {
    branch_name: { type: 'string', required: true },
    address: { type: 'text', allowNull: true },
    phone: { type: 'string', allowNull: true },
    is_main: { type: 'boolean', allowNull: true },
  },
  sales_channels: {
    channel_name: { type: 'string', required: true },
  },
  users: {
    full_name: { type: 'string', allowNull: true },
    phone: { type: 'string', allowNull: true },
    email: { type: 'string', allowNull: true },
    password_hash: { type: 'text', allowNull: true },
    role: { type: 'enum', values: ['admin', 'staff', 'cashier'], allowNull: false },
    branch_id: { type: 'uuid', allowNull: true },
    is_active: { type: 'boolean', allowNull: true },
  },
  customers: {
    full_name: { type: 'string', required: true },
    phone: { type: 'string', required: true },
    email: { type: 'string', allowNull: true },
    address: { type: 'text', allowNull: true },
    customer_type: { type: 'enum', values: ['online', 'walk-in'], allowNull: false },
  },
  suppliers: {
    supplier_name: { type: 'string', allowNull: true },
    phone: { type: 'string', required: true },
    email: { type: 'string', allowNull: true },
    address: { type: 'text', allowNull: true },
    supplier_type: { type: 'enum', values: ['online', 'physical', 'both'], allowNull: false },
    notes: { type: 'text', allowNull: true },
  },
  categories: {
    category_name: { type: 'string', allowNull: true },
    parent_id: { type: 'uuid', allowNull: true },
  },
  products: {
    product_name: { type: 'string', allowNull: true },
    description: { type: 'text', allowNull: true },
    photo_url: { type: 'string', allowNull: true },
    category_id: { type: 'uuid', allowNull: true },
    brand: { type: 'string', allowNull: true },
    status: { type: 'enum', values: ['active', 'archived'], allowNull: false },
  },
  product_variants: {
    product_id: { type: 'uuid', required: true },
    sku: { type: 'string', allowNull: true },
    class: { type: 'string', allowNull: true },
    product_type: { type: 'string', allowNull: true },
    brand: { type: 'string', allowNull: true },
    size: { type: 'string', allowNull: true },
    color: { type: 'string', allowNull: true },
    is_active: { type: 'boolean', allowNull: true },
    price: { type: 'numeric', allowNull: true },
    cost_price: { type: 'numeric', allowNull: true },
  },
  inventories: {
    branch_id: { type: 'uuid', required: true },
    product_variant_id: { type: 'uuid', required: true },
    quantity_on_hand: { type: 'number', allowNull: true },
    reorder_level: { type: 'number', allowNull: true },
  },
  inventory_movements: {
    branch_id: { type: 'uuid', allowNull: true },
    product_variant_id: { type: 'uuid', allowNull: true },
    movement_type: { type: 'enum', values: ['sale','restock','return','transfer','adjustment'], required: true },
    quantity: { type: 'number', required: true },
    reference_type: { type: 'string', allowNull: true },
    reference_id: { type: 'uuid', allowNull: true },
  },
  orders: {
    order_number: { type: 'string', allowNull: true },
    customer_id: { type: 'uuid', allowNull: true },
    branch_id: { type: 'uuid', allowNull: true },
    sales_channel_id: { type: 'uuid', allowNull: true },
    order_status: { type: 'enum', values: ['pending','partially_paid','paid','packed','shipped','completed','cancelled','returned'], allowNull: false },
    total_amount: { type: 'numeric', allowNull: true },
  },
  order_items: {
    order_id: { type: 'uuid', required: true },
    product_variant_id: { type: 'uuid', allowNull: true },
    quantity: { type: 'number', required: true },
    unit_price: { type: 'numeric', allowNull: true },
    subtotal: { type: 'numeric', allowNull: true },
  },
  payments: {
    order_id: { type: 'uuid', required: true },
    payment_method: { type: 'enum', values: ['cash','gcash','bank_transfer','card','cod'], required: true },
    amount: { type: 'numeric', required: true },
    received_by: { type: 'uuid', allowNull: true },
    payment_date: { type: 'timestamp', allowNull: true },
  },
  returns: {
    order_id: { type: 'uuid', required: true },
    branch_id: { type: 'uuid', allowNull: true },
    reason: { type: 'text', allowNull: true },
    return_status: { type: 'enum', values: ['pending','approved','rejected'], allowNull: false },
  },
  return_items: {
    return_id: { type: 'uuid', required: true },
    product_variant_id: { type: 'uuid', allowNull: true },
    quantity: { type: 'number', required: true },
  },
  purchase_orders: {
    supplier_id: { type: 'uuid', required: true },
    branch_id: { type: 'uuid', required: true },
    po_number: { type: 'string', required: true },
    status: { type: 'enum', values: ['draft','estimated','ordered','received','cancelled'], required: true },
    total_cost: { type: 'numeric', allowNull: true },
    shipping_cost: { type: 'numeric', allowNull: true },
    tipping_cost: { type: 'numeric', allowNull: true },
    miscellaneous_cost: { type: 'numeric', allowNull: true },
  },
  purchase_order_items: {
    purchase_order_id: { type: 'uuid', required: true },
    product_variant_id: { type: 'uuid', allowNull: true },
    quantity: { type: 'number', required: true },
    cost_price: { type: 'numeric', allowNull: true },
  },
  expenses: {
    branch_id: { type: 'uuid', allowNull: true },
    expense_type: { type: 'string', allowNull: true },
    description: { type: 'text', allowNull: true },
    amount: { type: 'numeric', allowNull: true },
    expense_date: { type: 'date', allowNull: true },
  }
};

function validate(table, data = {}, { requireAll = false } = {}) {
  const schema = schemas[table];
  if (!schema) return; // no schema defined -> skip
  Object.keys(schema).forEach((key) => {
    const rule = schema[key];
    const val = data[key];

    if (requireAll && rule.required && (val === undefined || val === null || val === '')) {
      throw new Error(`${table}.${key} is required`);
    }

    if (val === undefined) return; // not provided for this operation
    if (val === null) {
      if (rule.allowNull === false) throw new Error(`${table}.${key} cannot be null`);
      return;
    }

    switch (rule.type) {
      case 'string':
      case 'text':
        if (typeof val !== 'string') throw new Error(`${table}.${key} must be a string`);
        break;
      case 'number':
        if (typeof val !== 'number' || Number.isNaN(val)) throw new Error(`${table}.${key} must be a number`);
        break;
      case 'numeric':
        if (typeof val === 'number') break;
        if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) break;
        throw new Error(`${table}.${key} must be numeric`);
      case 'boolean':
        if (typeof val !== 'boolean') throw new Error(`${table}.${key} must be boolean`);
        break;
      case 'uuid':
        if (typeof val !== 'string' || !uuidRegex.test(val)) throw new Error(`${table}.${key} must be a UUID`);
        break;
      case 'enum':
        if (!rule.values || !Array.isArray(rule.values)) break;
        if (!rule.values.includes(val)) throw new Error(`${table}.${key} must be one of: ${rule.values.join(',')}`);
        break;
      case 'date':
      case 'timestamp':
        if (val instanceof Date) break;
        if (typeof val === 'string' && !Number.isNaN(Date.parse(val))) break;
        throw new Error(`${table}.${key} must be a valid date/time`);
      default:
        break;
    }
  });
}

module.exports = { schemas, validate };
