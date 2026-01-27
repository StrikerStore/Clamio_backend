const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateBasicAuth, requireAdminOrSuperadmin } = require('../middleware/auth');
const inventoryController = require('../controllers/inventoryController');
const productMonitorService = require('../services/productMonitorService');

// Configure multer for file upload (memory storage for CSV)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept CSV files with various mimetypes (different systems report different types for CSV)
    const isCSV =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv' ||
      file.mimetype === 'text/plain' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/x-csv' ||
      file.originalname.toLowerCase().endsWith('.csv');

    if (isCSV) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed. Received mimetype: ' + file.mimetype));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

/**
 * @route   GET /api/admin/inventory/aggregate
 * @desc    Get aggregated inventory for unclaimed orders
 * @access  Admin, Superadmin
 */
router.get(
  '/aggregate',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.getAggregatedInventory
);

/**
 * @route   POST /api/admin/inventory/rto-upload
 * @desc    Upload and parse RTO details CSV
 * @access  Admin, Superadmin
 */
router.post(
  '/rto-upload',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  upload.single('rto_file'),
  inventoryController.uploadRTODetails
);

/**
 * @route   GET /api/admin/inventory/rto
 * @desc    Get RTO inventory from database with product names
 * @access  Admin, Superadmin
 */
router.get(
  '/rto',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.getRTOInventory
);

/**
 * @route   PUT /api/admin/inventory/rto
 * @desc    Batch update RTO inventory quantities
 * @access  Admin, Superadmin
 */
router.put(
  '/rto',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.updateRTOInventory
);

/**
 * @route   GET /api/admin/inventory/rto-focus
 * @desc    Get RTO focus orders (is_focus = 1, instance_number = 1)
 * @access  Admin, Superadmin
 */
router.get(
  '/rto-focus',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.getRTOFocusOrders
);

/**
 * @route   PUT /api/admin/inventory/rto-focus/status
 * @desc    Update RTO focus orders status (batch update)
 * @access  Admin, Superadmin
 */
router.put(
  '/rto-focus/status',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.updateRTOFocusStatus
);

/**
 * @route   GET /api/admin/inventory/rto-locations
 * @desc    Get distinct RTO warehouse locations for dropdown
 * @access  Admin, Superadmin
 */
router.get(
  '/rto-locations',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.getRTOLocations
);

/**
 * @route   GET /api/admin/inventory/rto-products
 * @desc    Get products for RTO dropdown
 * @access  Admin, Superadmin
 */
router.get(
  '/rto-products',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.getRTOProducts
);

/**
 * @route   GET /api/admin/inventory/rto-sizes/:skuId
 * @desc    Get sizes for a specific product
 * @access  Admin, Superadmin
 */
router.get(
  '/rto-sizes/:skuId',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.getSizesForProduct
);

/**
 * @route   POST /api/admin/inventory/rto-manual
 * @desc    Add manual RTO inventory entry
 * @access  Admin, Superadmin
 */
router.post(
  '/rto-manual',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  inventoryController.addManualRTOEntry
);

/**
 * @route   GET /api/admin/inventory/products/new
 * @desc    Check for new products added in the last 24 hours
 * @access  Admin, Superadmin
 */
router.get(
  '/products/new',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  async (req, res) => {
    try {
      const result = await productMonitorService.checkNewProducts();

      res.json({
        success: true,
        message: `Found ${result.count} new product(s) in the last 24 hours`,
        data: result
      });
    } catch (error) {
      console.error('[API] Error checking new products:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check new products',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /api/admin/inventory/products/new/:hours
 * @desc    Check for new products added in the last N hours
 * @access  Admin, Superadmin
 */
router.get(
  '/products/new/:hours',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  async (req, res) => {
    try {
      const hours = parseInt(req.params.hours);

      if (isNaN(hours) || hours <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid hours parameter. Must be a positive number.'
        });
      }

      const result = await productMonitorService.checkNewProductsCustomWindow(hours);

      res.json({
        success: true,
        message: `Found ${result.count} new product(s) in the last ${hours} hours`,
        data: result
      });
    } catch (error) {
      console.error('[API] Error checking new products:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check new products',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /api/admin/inventory/products/updated/:hours
 * @desc    Check for products updated in the last N hours
 * @access  Admin, Superadmin
 */
router.get(
  '/products/updated/:hours',
  authenticateBasicAuth,
  requireAdminOrSuperadmin,
  async (req, res) => {
    try {
      const hours = parseInt(req.params.hours);

      if (isNaN(hours) || hours <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid hours parameter. Must be a positive number.'
        });
      }

      const result = await productMonitorService.checkUpdatedProducts(hours);

      res.json({
        success: true,
        message: `Found ${result.count} updated product(s) in the last ${hours} hours`,
        data: result
      });
    } catch (error) {
      console.error('[API] Error checking updated products:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check updated products',
        error: error.message
      });
    }
  }
);

module.exports = router;

