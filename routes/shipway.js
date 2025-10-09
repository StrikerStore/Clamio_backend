const express = require('express');
const router = express.Router();
const multer = require('multer');
const shipwayController = require('../controllers/shipwayController');
const { authenticateBasicAuth, requireAdminOrSuperadmin } = require('../middleware/auth');
const { validateWarehouseId } = require('../middleware/validation');

// Configure multer for CSV file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept CSV files and be more lenient with MIME types
    const validMimeTypes = ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'];
    const hasValidExtension = file.originalname.toLowerCase().endsWith('.csv');
    const hasValidMimeType = validMimeTypes.some(mime => file.mimetype.includes(mime));
    
    if (hasValidExtension || hasValidMimeType) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

/**
 * Shipway API Routes
 * Handles warehouse validation and data fetching
 */

/**
 * @route   GET /api/shipway/warehouse/:warehouseId
 * @desc    Get warehouse details by warehouse ID
 * @access  Superadmin only
 */
router.get('/warehouse/:warehouseId', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  validateWarehouseId, 
  shipwayController.getWarehouseById
);

/**
 * @route   GET /api/shipway/validate/:warehouseId
 * @desc    Validate warehouse ID format
 * @access  Superadmin only
 */
router.get('/validate/:warehouseId', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  validateWarehouseId, 
  shipwayController.validateWarehouseId
);

/**
 * @route   GET /api/shipway/test-connection
 * @desc    Test Shipway API connectivity
 * @access  Superadmin only
 */
router.get('/test-connection', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  shipwayController.testConnection
);

/**
 * @route   POST /api/shipway/validate-warehouse
 * @desc    Validate warehouse for user creation
 * @access  Superadmin only
 */
router.post('/validate-warehouse', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  shipwayController.validateWarehouseForUser
);

/**
 * @route   POST /api/shipway/multiple-warehouses
 * @desc    Get multiple warehouses by IDs
 * @access  Superadmin only
 */
router.post('/multiple-warehouses', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  shipwayController.getMultipleWarehouses
);

/**
 * @route   GET /api/shipway/stats
 * @desc    Get warehouse API statistics
 * @access  Superadmin only
 */
router.get('/stats', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  shipwayController.getWarehouseStats
);

/**
 * @route   GET /api/shipway/verify-warehouse/:warehouseId
 * @desc    Verify a warehouse by ID and return address, city, pincode
 * @access  Superadmin only
 */
router.get('/verify-warehouse/:warehouseId', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  const { warehouseId } = req.params;
  try {
    const warehouseData = await require('../services/shipwayService').getWarehouseById(warehouseId);
    if (!warehouseData.success) {
      return res.status(404).json({ success: false, message: 'Warehouse not found' });
    }
    const details = require('../services/shipwayService').formatWarehouseData(warehouseData.data);
    res.json({
      success: true,
      data: {
        address: details.address,
        city: details.city,
        pincode: details.pincode,
        state: details.state,
        country: details.country
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/shipway/carriers
 * @desc    Get all carriers from Shipway API and sync to MySQL
 * @access  Superadmin only
 */
router.get('/carriers', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    console.log('🔵 SHIPWAY CARRIERS: API request received');
    
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const result = await shipwayCarrierService.syncCarriersToMySQL();
    
    res.json({
      success: true,
      message: result.message,
      data: {
        carrierCount: result.carrierCount,
        database: result.database,
        inserted: result.inserted,
        updated: result.updated
      }
    });
  } catch (error) {
    console.error('💥 SHIPWAY CARRIERS: API error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   GET /api/shipway/carriers/local
 * @desc    Get carriers from local MySQL database
 * @access  Superadmin only
 */
router.get('/carriers/local', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    console.log('🔵 SHIPWAY CARRIERS LOCAL: API request received');
    
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const carriers = await shipwayCarrierService.readCarriersFromDatabase();
    
    res.json({
      success: true,
      message: `Successfully loaded ${carriers.length} carriers from database`,
      data: {
        carriers: carriers,
        carrierCount: carriers.length
      }
    });
  } catch (error) {
    console.error('💥 SHIPWAY CARRIERS LOCAL: API error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   POST /api/shipway/carriers/sync
 * @desc    Manually trigger carrier sync from Shipway API
 * @access  Superadmin only
 */
router.post('/carriers/sync', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    console.log('🔵 SHIPWAY CARRIERS SYNC: Manual sync request received');
    
    const carrierSyncService = require('../services/carrierSyncService');
    const result = await carrierSyncService.startCarrierSync();
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          carrierCount: result.carrierCount,
          filePath: result.filePath,
          timestamp: result.timestamp
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message,
        timestamp: result.timestamp
      });
    }
  } catch (error) {
    console.error('💥 SHIPWAY CARRIERS SYNC: API error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   GET /api/shipway/carriers/status
 * @desc    Get carrier sync status
 * @access  Superadmin only
 */
router.get('/carriers/status', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    console.log('🔵 SHIPWAY CARRIERS STATUS: Status request received');
    
    const carrierSyncService = require('../services/carrierSyncService');
    const status = carrierSyncService.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('💥 SHIPWAY CARRIERS STATUS: API error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   GET /api/shipway/carriers/download
 * @desc    Download carriers data as CSV file
 * @access  Admin/Superadmin only
 */
router.get('/carriers/download', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    console.log('🔵 SHIPWAY CARRIERS DOWNLOAD: API request received');
    
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const csvContent = await shipwayCarrierService.exportCarriersToCSV();
    
    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="carriers.csv"');
    
    res.send(csvContent);
  } catch (error) {
    console.error('💥 SHIPWAY CARRIERS DOWNLOAD: API error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   POST /api/shipway/carriers/upload-priority
 * @desc    Upload CSV file to update carrier priorities
 * @access  Admin/Superadmin only
 */
router.post('/carriers/upload-priority', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  (req, res, next) => {
    upload.single('csvFile')(req, res, (err) => {
      if (err) {
        console.error('💥 MULTER ERROR:', err.message);
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed'
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      console.log('🔵 SHIPWAY CARRIERS UPLOAD PRIORITY: API request received');
      console.log('🔍 Request file:', req.file);
      console.log('🔍 Request body:', req.body);
      
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No CSV file uploaded. Please select a file.'
        });
      }

      console.log('🔍 CSV File received:', {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer ? req.file.buffer.length : 'no buffer'
      });

      // Validate file has data
      if (!req.file.buffer || req.file.buffer.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'File appears to be empty. Please upload a valid CSV file.'
        });
      }

      const shipwayCarrierService = require('../services/shipwayCarrierService');
      const csvContent = req.file.buffer.toString('utf8');
      console.log('🔍 CSV Content to process:', csvContent.substring(0, 200) + '...');
      console.log('🔍 CSV Content full length:', csvContent.length);
      
      const result = await shipwayCarrierService.updateCarrierPrioritiesFromCSV(csvContent);
      
      res.json({
        success: true,
        message: result.message,
        data: {
          updatedCount: result.updatedCount,
          totalCarriers: result.totalCarriers
        }
      });
    } catch (error) {
      console.error('💥 SHIPWAY CARRIERS UPLOAD PRIORITY: API error:', error.message);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/shipway/carriers/test-upload
 * @desc    Test file upload functionality
 * @access  Admin/Superadmin only
 */
router.post('/carriers/test-upload', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  upload.single('csvFile'), 
  async (req, res) => {
    try {
      console.log('🔵 TEST UPLOAD: API request received');
      console.log('🔍 Request file:', req.file);
      console.log('🔍 Request body:', req.body);
      console.log('🔍 Request headers:', req.headers);
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No files were uploaded.'
        });
      }

      console.log('🔍 Uploaded file:', {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer ? req.file.buffer.length : 'no buffer'
      });

      res.json({
        success: true,
        message: 'File upload test successful',
        data: {
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          bufferLength: req.file.buffer ? req.file.buffer.length : 0
        }
      });
    } catch (error) {
      console.error('💥 TEST UPLOAD: API error:', error.message);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/shipway/carriers/test-simple
 * @desc    Simple test endpoint for file upload
 * @access  Admin/Superadmin only
 */
router.post('/carriers/test-simple', 
  authenticateBasicAuth, 
  requireAdminOrSuperadmin, 
  (req, res, next) => {
    upload.single('csvFile')(req, res, (err) => {
      if (err) {
        console.error('💥 MULTER ERROR:', err.message);
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed'
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      console.log('🔵 SIMPLE TEST: API request received');
      console.log('🔍 Request file:', req.file);
      console.log('🔍 Request body:', req.body);
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      res.json({
        success: true,
        message: 'File received successfully',
        data: {
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          bufferLength: req.file.buffer ? req.file.buffer.length : 0
        }
      });
    } catch (error) {
      console.error('💥 SIMPLE TEST: API error:', error.message);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/shipway/carrier-format
 * @desc    Get expected CSV format and validation rules (frontend compatibility)
 * @access  Admin/Superadmin only
 */
router.get('/carrier-format', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    console.log('🔵 SHIPWAY CARRIER FORMAT: API request received');
    
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const formatInfo = await shipwayCarrierService.getExpectedCSVFormat();
    
    res.json({
      success: true,
      message: 'CSV format requirements retrieved successfully',
      data: formatInfo
    });
  } catch (error) {
    console.error('💥 SHIPWAY CARRIER FORMAT: API error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to get CSV format requirements',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/shipway/carriers/format
 * @desc    Get expected CSV format and validation rules
 * @access  Admin/Superadmin only
 */
router.get('/carriers/format', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    console.log('🔵 SHIPWAY CARRIERS FORMAT: API request received');
    
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const formatInfo = await shipwayCarrierService.getExpectedCSVFormat();
    
    res.json({
      success: true,
      message: 'CSV format requirements retrieved successfully',
      data: formatInfo
    });
  } catch (error) {
    console.error('💥 SHIPWAY CARRIERS FORMAT: API error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   GET /api/shipway/carrier-format
 * @desc    Backward-compatible alias for CSV format endpoint
 * @access  Admin/Superadmin only
 */
router.get('/carrier-format', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    console.log('🔵 SHIPWAY CARRIERS FORMAT (alias): API request received');
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const formatInfo = shipwayCarrierService.getExpectedCSVFormat();
    res.json({
      success: true,
      message: 'CSV format requirements retrieved successfully',
      data: formatInfo
    });
  } catch (error) {
    console.error('💥 SHIPWAY CARRIERS FORMAT (alias): API error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/shipway/carriers/:carrierId
 * @desc    Update carrier fields (carrier_id, status)
 * @access  Admin/Superadmin only
 */
router.put('/carriers/:carrierId', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { carrierId } = req.params;
    const { carrier_id, status } = req.body || {};
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const result = shipwayCarrierService.updateCarrier(carrierId, { carrier_id, status });
    res.json({ success: true, message: result.message, data: result.carrier });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * @route   DELETE /api/shipway/carriers/:carrierId
 * @desc    Delete carrier
 * @access  Admin/Superadmin only
 */
router.delete('/carriers/:carrierId', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { carrierId } = req.params;
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const result = shipwayCarrierService.deleteCarrier(carrierId);
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * @route   POST /api/shipway/carriers/:carrierId/move
 * @desc    Move carrier up or down in priority
 * @access  Admin/Superadmin only
 */
router.post('/carriers/:carrierId/move', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { carrierId } = req.params;
    const { direction } = req.body || {};
    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({ success: false, message: 'direction must be "up" or "down"' });
    }
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const result = await shipwayCarrierService.moveCarrier(carrierId, direction);
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * @route   POST /api/shipway/carriers/normalize-priorities
 * @desc    Normalize carrier priorities to be sequential (1, 2, 3, ...)
 * @access  Admin/Superadmin only
 */
router.post('/carriers/normalize-priorities', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const shipwayCarrierService = require('../services/shipwayCarrierService');
    const result = await shipwayCarrierService.normalizeCarrierPriorities();
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router; 