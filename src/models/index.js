// Minimal models index: exports helpers and table names.
// This project uses the `pg` Pool directly. For richer ORM features
// you can add Sequelize/Knex/Objection later. For now, keep simple
// helper functions that use the shared `pool` from `src/db.js`.

const { pool } = require('../db');

module.exports = {
  pool,
  tables: {
    branches: 'branches',
    sales_channels: 'sales_channels',
    users: 'users',
    customers: 'customers',
    suppliers: 'suppliers',
    categories: 'categories',
    products: 'products',
    product_variants: 'product_variants',
    inventories: 'inventories',
    inventory_movements: 'inventory_movements',
    orders: 'orders',
    order_items: 'order_items',
    payments: 'payments',
    returns: 'returns',
    return_items: 'return_items',
    purchase_orders: 'purchase_orders',
    purchase_order_items: 'purchase_order_items',
    expenses: 'expenses'
  }
};
