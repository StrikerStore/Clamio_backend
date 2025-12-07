/**
 * Warehouse Mapping Routes
 * Handles warehouse mapping operations (claimio_wh_id to vendor_wh_id mapping per account_code)
 */

const express = require('express');
const router = express.Router();
const database = require('../config/database');
const { authenticateBasicAuth, requireAdminOrSuperadmin } = require('../middleware/auth');

/**
 * @route   GET /api/warehouse-mapping
 * @desc    Get all warehouse mappings (for admin display)
 * @access  Admin/Superadmin only
 */
router.get('/', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ 
        success: false, 
        message: 'Database connection not available' 
      });
    }

    const includeInactive = req.query.includeInactive === 'true';
    const mappings = await database.getAllWhMappings(includeInactive);

    return res.status(200).json({
      success: true,
      data: mappings
    });
  } catch (error) {
    console.error('Error getting warehouse mappings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get warehouse mappings',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/warehouse-mapping/vendors
 * @desc    Get all vendors with warehouse IDs (for dropdown)
 * @access  Admin/Superadmin only
 */
router.get('/vendors', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ 
        success: false, 
        message: 'Database connection not available' 
      });
    }

    const users = await database.getAllUsers();
    const vendors = users
      .filter(user => user.role === 'vendor' && user.warehouseId)
      .map(vendor => ({
        warehouse_id: vendor.warehouseId,
        name: vendor.name,
        id: vendor.id
      }));

    return res.status(200).json({
      success: true,
      data: vendors
    });
  } catch (error) {
    console.error('Error getting vendors:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get vendors',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/warehouse-mapping/stores
 * @desc    Get all stores with account_code and store_name (for dropdown)
 * @access  Admin/Superadmin only
 */
router.get('/stores', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ 
        success: false, 
        message: 'Database connection not available' 
      });
    }

    const stores = await database.getAllStores();
    const storeList = stores
      .filter(store => store.status === 'active')
      .map(store => ({
        account_code: store.account_code,
        store_name: store.store_name
      }));

    return res.status(200).json({
      success: true,
      data: storeList
    });
  } catch (error) {
    console.error('Error getting stores:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get stores',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/warehouse-mapping/validate
 * @desc    Validate vendor_wh_id against Shipway API for given account_code
 * @access  Admin/Superadmin only
 */
router.post('/validate', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { vendor_wh_id, account_code } = req.body;

    if (!vendor_wh_id || !account_code) {
      return res.status(400).json({
        success: false,
        message: 'vendor_wh_id and account_code are required'
      });
    }

    // Validate account_code exists in store_info
    const store = await database.getStoreByAccountCode(account_code);
    if (!store) {
      return res.status(400).json({
        success: false,
        message: 'Store not found for the provided account_code'
      });
    }

    if (store.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Store is not active'
      });
    }

    // Validate vendor_wh_id against Shipway API using store credentials
    const ShipwayService = require('../services/shipwayService');
    const shipway = new ShipwayService(account_code);
    await shipway.initialize();
    
    const warehouseData = await shipway.getWarehouseById(vendor_wh_id);
    
    if (!warehouseData.success) {
      return res.status(400).json({
        success: false,
        message: 'Warehouse not found in Shipway system for this store',
        data: null
      });
    }

    // Format warehouse data
    const formattedWarehouse = shipway.formatWarehouseData(warehouseData.data);

    return res.status(200).json({
      success: true,
      message: 'Warehouse validated successfully',
      data: {
        vendor_wh_id,
        account_code,
        warehouse: {
          address: formattedWarehouse.address,
          city: formattedWarehouse.city,
          pincode: formattedWarehouse.pincode,
          state: formattedWarehouse.state || '',
          country: formattedWarehouse.country || ''
        }
      }
    });
  } catch (error) {
    console.error('Error validating warehouse:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to validate warehouse',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/warehouse-mapping
 * @desc    Create new warehouse mapping
 * @access  Admin/Superadmin only
 */
router.post('/', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { claimio_wh_id, vendor_wh_id, account_code, return_warehouse_id } = req.body;

    if (!claimio_wh_id || !vendor_wh_id || !account_code) {
      return res.status(400).json({
        success: false,
        message: 'claimio_wh_id, vendor_wh_id, and account_code are required'
      });
    }

    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ 
        success: false, 
        message: 'Database connection not available' 
      });
    }

    // Validate claimio_wh_id exists in users table
    const vendor = await database.getUserByWarehouseId(claimio_wh_id);
    if (!vendor || vendor.role !== 'vendor') {
      return res.status(400).json({
        success: false,
        message: 'Vendor not found for the provided claimio_wh_id'
      });
    }

    // Validate account_code exists in store_info
    const store = await database.getStoreByAccountCode(account_code);
    if (!store) {
      return res.status(400).json({
        success: false,
        message: 'Store not found for the provided account_code'
      });
    }

    // Check if active mapping already exists
    const exists = await database.activeWhMappingExists(claimio_wh_id, account_code);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Active mapping already exists for this claimio_wh_id and account_code combination'
      });
    }

    // Create mapping
    const mapping = await database.createWhMapping({
      claimio_wh_id,
      vendor_wh_id,
      account_code,
      return_warehouse_id: return_warehouse_id || null
    });

    return res.status(201).json({
      success: true,
      message: 'Warehouse mapping created successfully',
      data: mapping
    });
  } catch (error) {
    console.error('Error creating warehouse mapping:', error);
    
    if (error.message.includes('already exists')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to create warehouse mapping',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/warehouse-mapping/:id
 * @desc    Soft delete warehouse mapping (set is_active = FALSE)
 * @access  Admin/Superadmin only
 */
router.delete('/:id', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Mapping ID is required'
      });
    }

    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ 
        success: false, 
        message: 'Database connection not available' 
      });
    }

    // Check if mapping exists
    const mapping = await database.getWhMappingById(id);
    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse mapping not found'
      });
    }

    // Soft delete (set is_active = FALSE)
    const deleted = await database.deleteWhMapping(id);

    if (!deleted) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete warehouse mapping'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Warehouse mapping deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting warehouse mapping:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete warehouse mapping',
      error: error.message
    });
  }
});

module.exports = router;

