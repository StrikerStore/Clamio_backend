/**
 * Store Routes
 * API endpoints for store management (Superadmin only)
 */

const express = require('express');
const router = express.Router();
const storeController = require('../controllers/storeController');
const { authenticateSuperAdmin, authenticateAdmin } = require('../middleware/auth');

/**
 * @route   GET /api/stores/list-for-filter
 * @desc    Get store list for filtering (only account_code and store_name)
 * @access  Admin/Superadmin
 */
router.get('/list-for-filter', authenticateAdmin, storeController.getStoreListForFilter);

// All routes below require superadmin authentication
router.use(authenticateSuperAdmin);

/**
 * @route   GET /api/stores/shipping-partners
 * @desc    Get all available shipping partners
 * @access  Superadmin
 */
router.get('/shipping-partners', storeController.getShippingPartners);

/**
 * @route   GET /api/stores
 * @desc    Get all stores
 * @access  Superadmin
 */
router.get('/', storeController.getAllStores);

/**
 * @route   GET /api/stores/:accountCode
 * @desc    Get store by account code
 * @access  Superadmin
 */
router.get('/:accountCode', storeController.getStoreByCode);

/**
 * @route   POST /api/stores
 * @desc    Create new store
 * @access  Superadmin
 * @body    { store_name, shipping_partner, username, password, shopify_store_url, shopify_token, status }
 */
router.post('/', storeController.createStore);

/**
 * @route   PUT /api/stores/:accountCode
 * @desc    Update store
 * @access  Superadmin
 * @body    { store_name?, username?, password?, shopify_store_url?, shopify_token?, status? }
 */
router.put('/:accountCode', storeController.updateStore);

/**
 * @route   DELETE /api/stores/:accountCode
 * @desc    Delete store (soft delete)
 * @access  Superadmin
 */
router.delete('/:accountCode', storeController.deleteStore);

/**
 * @route   PATCH /api/stores/:accountCode/toggle-status
 * @desc    Toggle store status (active/inactive)
 * @access  Superadmin
 */
router.patch('/:accountCode/toggle-status', storeController.toggleStoreStatus);

/**
 * @route   POST /api/stores/test-shipway
 * @desc    Test Shipway connection
 * @access  Superadmin
 * @body    { username, password }
 */
router.post('/test-shipway', storeController.testShipwayConnection);

/**
 * @route   POST /api/stores/test-shopify
 * @desc    Test Shopify connection
 * @access  Superadmin
 * @body    { shopify_store_url, shopify_token }
 */
router.post('/test-shopify', storeController.testShopifyConnection);

/**
 * @route   POST /api/stores/sync-all
 * @desc    Sync all active stores in parallel
 * @access  Superadmin
 * @body    { concurrencyLimit? }
 */
router.post('/sync-all', storeController.syncAllStores);

/**
 * @route   POST /api/stores/:accountCode/sync
 * @desc    Sync a single store
 * @access  Superadmin
 */
router.post('/:accountCode/sync', storeController.syncSingleStore);

module.exports = router;

