const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateBasicAuth, requireAdminOrSuperadmin } = require('../middleware/auth');
const inventoryController = require('../controllers/inventoryController');

// Configure multer for file upload (memory storage for CSV)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept only CSV files
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
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

module.exports = router;

