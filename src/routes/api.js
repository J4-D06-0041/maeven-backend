const express = require('express');
const openapi = require('../openapi.json');
const { createService } = require('../services/genericService');
const { createController } = require('../controllers/genericController');

const branchesModel = require('../models/branches');
const productsModel = require('../models/products');
const productVariantsModel = require('../models/productVariants');
const inventoriesModel = require('../models/inventories');
const usersModel = require('../models/users');
const customersModel = require('../models/customers');
const suppliersModel = require('../models/suppliers');
const categoriesModel = require('../models/categories');
const salesChannelsModel = require('../models/salesChannels');
const ordersModel = require('../models/orders');
const orderItemsModel = require('../models/orderItems');
const paymentsModel = require('../models/payments');
const purchaseOrdersModel = require('../models/purchaseOrders');
const expensesModel = require('../models/expenses');
const returnsModel = require('../models/returns');

const router = express.Router();

// Serve the OpenAPI JSON for import tools (e.g., bolt.new)
router.get('/openapi.json', (req, res) => {
  res.type('application/json');
  return res.json(openapi);
});

function wire(path, model, opts = {}) {
  const svc = createService(model);
  const ctrl = createController(svc, opts.resourceName || path);
  const base = `/${path}`;
  router.get(base, ctrl.list);
  router.get(`${base}/:id`, ctrl.get);
  router.post(base, ctrl.create);
  router.put(`${base}/:id`, ctrl.update);
  router.delete(`${base}/:id`, ctrl.remove);
}

wire('branches', branchesModel, { resourceName: 'branch' });
wire('sales-channels', salesChannelsModel, { resourceName: 'sales_channel' });
wire('users', usersModel, { resourceName: 'user' });
wire('customers', customersModel, { resourceName: 'customer' });
wire('suppliers', suppliersModel, { resourceName: 'supplier' });
wire('categories', categoriesModel, { resourceName: 'category' });
wire('products', productsModel, { resourceName: 'product' });
wire('product-variants', productVariantsModel, { resourceName: 'product_variant' });
wire('inventories', inventoriesModel, { resourceName: 'inventory' });
wire('orders', ordersModel, { resourceName: 'order' });
wire('order-items', orderItemsModel, { resourceName: 'order_item' });
wire('payments', paymentsModel, { resourceName: 'payment' });
wire('purchase-orders', purchaseOrdersModel, { resourceName: 'purchase_order' });
wire('expenses', expensesModel, { resourceName: 'expense' });
wire('returns', returnsModel, { resourceName: 'return' });

module.exports = router;
