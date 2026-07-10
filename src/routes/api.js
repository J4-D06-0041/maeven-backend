const express = require('express');
const fs = require('fs');
const path = require('path');
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
const purchaseOrderItemsModel = require('../models/purchaseOrderItems');
const purchaseOrderEstimatesController = require('../controllers/purchaseOrderEstimatesController');
const purchaseOrderItemService = require('../services/purchaseOrderItemService');
const purchaseOrderService = require('../services/purchaseOrderService');
const gcashFeeRuleService = require('../services/gcashFeeRuleService');
const expensesModel = require('../models/expenses');
const returnsModel = require('../models/returns');
const gcashTransactionsController = require('../controllers/gcashTransactionsController');
const prepaidLoadTransactionsController = require('../controllers/prepaidLoadTransactionsController');
const reportsController = require('../controllers/reportsController');
const cashReconciliationsController = require('../controllers/cashReconciliationsController');
const prepaidLoadProductsModel = require('../models/prepaidLoadProducts');

const router = express.Router();
const auth = require('../middleware/auth');
// Attach decoded user (if Authorization header with valid JWT is present)
router.use(auth);

// Serve the OpenAPI JSON for import tools (e.g., bolt.new)
router.get('/openapi.json', (req, res) => {
  try {
    const specPath = path.join(__dirname, '..', 'openapi.json');
    const raw = fs.readFileSync(specPath, 'utf8');
    res.type('application/json');
    return res.json(JSON.parse(raw));
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

function wire(path, model, opts = {}) {
  const svc = createService(model);
  const ctrl = createController(svc, opts.resourceName || path);
  const base = `/${path}`;
  router.get(base, ctrl.list);
  router.get(`${base}/:id`, ctrl.get);
  if (opts.requireAuth) {
    router.post(base, auth.requireAuth, ctrl.create);
    router.put(`${base}/:id`, auth.requireAuth, ctrl.update);
    router.delete(`${base}/:id`, auth.requireAuth, ctrl.remove);
  } else {
    router.post(base, ctrl.create);
    router.put(`${base}/:id`, ctrl.update);
    router.delete(`${base}/:id`, ctrl.remove);
  }
}

wire('branches', branchesModel, { resourceName: 'branch' });
wire('sales-channels', salesChannelsModel, { resourceName: 'sales_channel' });
wire('users', usersModel, { resourceName: 'user' });
wire('customers', customersModel, { resourceName: 'customer' });
wire('suppliers', suppliersModel, { resourceName: 'supplier' });
wire('categories', categoriesModel, { resourceName: 'category' });
wire('products', productsModel, { resourceName: 'product' });

// Custom wiring for product-variants to support optional filters via query params
{
  const pathName = 'product-variants';
  const svc = createService(productVariantsModel);
  const ctrl = createController(svc, 'product_variant');
  const base = `/${pathName}`;

  // List with optional filters: /api/product-variants?is_active=true&product_id=<uuid>
  router.get(base, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const offset = Number(req.query.offset) || 0;
      const whereParts = [];
      const params = [];
      if (req.query.product_id) {
        params.push(req.query.product_id);
        whereParts.push(`product_id = $${params.length}`);
      }
      if (req.query.is_active !== undefined) {
        // accept "true"|"false" (string) or boolean
        const val = (req.query.is_active === 'true' || req.query.is_active === true || req.query.is_active === '1');
        params.push(val);
        whereParts.push(`is_active = $${params.length}`);
      }
      const where = whereParts.length ? whereParts.join(' AND ') : '';
      const items = await productVariantsModel.list({ limit, offset, where, params });
      return res.json({ ok: true, data: items });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Nested route: list variants by product id
  router.get('/products/:productId/variants', async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const offset = Number(req.query.offset) || 0;
      const whereParts = ['product_id = $1'];
      const params = [req.params.productId];

      if (req.query.is_active !== undefined) {
        const val = (req.query.is_active === 'true' || req.query.is_active === true || req.query.is_active === '1');
        params.push(val);
        whereParts.push(`is_active = $${params.length}`);
      }

      const where = whereParts.join(' AND ');
      const items = await productVariantsModel.list({ limit, offset, where, params });
      return res.json({ ok: true, data: items });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get(`${base}/:id`, ctrl.get);
  router.post(base, ctrl.create);
  router.put(`${base}/:id`, ctrl.update);
  router.delete(`${base}/:id`, ctrl.remove);
}
wire('inventories', inventoriesModel, { resourceName: 'inventory' });
wire('orders', ordersModel, { resourceName: 'order' });
wire('order-items', orderItemsModel, { resourceName: 'order_item' });
// Nested route: list items for a given order
router.get('/orders/:orderId/items', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const orderId = req.params.orderId;
    const items = await orderItemsModel.list({ where: 'order_id = $1', params: [orderId], limit, offset });
    return res.json({ ok: true, data: items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
wire('payments', paymentsModel, { resourceName: 'payment', requireAuth: true });
const gfrCtrl = createController(gcashFeeRuleService, 'gcash_fee_rule');
const gfrBase = '/gcash-fee-rules';
router.get(gfrBase, gfrCtrl.list);
router.get(`${gfrBase}/:id`, gfrCtrl.get);
router.post(gfrBase, auth.requireAuth, gfrCtrl.create);
router.put(`${gfrBase}/:id`, auth.requireAuth, gfrCtrl.update);
router.delete(`${gfrBase}/:id`, auth.requireAuth, gfrCtrl.remove);

// Custom routes for GCash transactions to enforce fee-by-range and cash-impact rules.
router.get('/gcash-transactions', auth.requireAuth, gcashTransactionsController.list);
router.get('/gcash-transactions/:id', auth.requireAuth, gcashTransactionsController.get);
router.post('/gcash-transactions', auth.requireAuth, gcashTransactionsController.create);

// Prepaid load catalog (editable markup per load item)
wire('prepaid-load-products', prepaidLoadProductsModel, {
  resourceName: 'prepaid_load_product',
  requireAuth: true,
});

// Prepaid load transactions
router.get('/prepaid-load-transactions', auth.requireAuth, prepaidLoadTransactionsController.list);
router.get('/prepaid-load-transactions/:id', auth.requireAuth, prepaidLoadTransactionsController.get);
router.post('/prepaid-load-transactions', auth.requireAuth, prepaidLoadTransactionsController.create);

wire('purchase-orders', purchaseOrdersModel, { resourceName: 'purchase_order' });
// Use a custom service for purchase order items to enforce creation rules
const poiCtrl = createController(purchaseOrderItemService, 'purchase_order_item');
const poiBase = '/purchase-order-items';
router.get(poiBase, poiCtrl.list);
router.get(`${poiBase}/:id`, poiCtrl.get);
router.post(poiBase, poiCtrl.create);
router.put(`${poiBase}/:id`, poiCtrl.update);
router.delete(`${poiBase}/:id`, poiCtrl.remove);

// Nested routes for purchase order estimates (under a purchase order)
router.get('/purchase-orders/:poId/estimates', purchaseOrderEstimatesController.list);
router.post('/purchase-orders/:poId/estimates', purchaseOrderEstimatesController.create);
router.get('/purchase-orders/:poId/estimates/:id', purchaseOrderEstimatesController.get);
router.put('/purchase-orders/:poId/estimates/:id', purchaseOrderEstimatesController.update);
router.delete('/purchase-orders/:poId/estimates/:id', purchaseOrderEstimatesController.remove);
// Get purchase orders with aggregated item totals (items_total, items_count)
router.get('/purchase-orders-with-totals', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const where = req.query.where || '';
    // Note: `where` should be a SQL fragment and `params` may be passed as a JSON array in query (not common).
    const params = [];
    const items = await purchaseOrdersModel.listWithItemTotals({ limit, offset, where, params });
    return res.json({ ok: true, data: items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
// Variance endpoint: estimated vs actual totals for a purchase order
router.get('/purchase-orders/:id/variance', async (req, res) => {
  try {
    const data = await purchaseOrderService.getVariance(req.params.id);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
wire('expenses', expensesModel, { resourceName: 'expense' });
wire('returns', returnsModel, { resourceName: 'return' });

// Reports
router.get('/reports/sales', reportsController.salesSummary);
router.get('/reports/sales/overview', reportsController.overviewSummary);
router.get('/reports/sales/payments', reportsController.paymentBreakdown);
router.get('/reports/sales/top-products', reportsController.topProducts);
router.get('/reports/cash-reconciliation/daily', auth.requireAuth, reportsController.dailyCashReconciliation);

// Cash reconciliation workflow
router.get('/cash-reconciliations', auth.requireAuth, cashReconciliationsController.list);
router.get('/cash-reconciliations/:id', auth.requireAuth, cashReconciliationsController.get);
router.post('/cash-reconciliations/open', auth.requireAuth, cashReconciliationsController.open);
router.put('/cash-reconciliations/open', auth.requireAuth, cashReconciliationsController.upsertOpen);
router.post('/cash-reconciliations/:id/close', auth.requireAuth, cashReconciliationsController.close);
router.delete('/cash-reconciliations/:id', auth.requireAuth, cashReconciliationsController.remove);

module.exports = router;
