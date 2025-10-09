const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const database = require('../config/database');

const fs = require('fs');
const path = require('path');
const shipwayService = require('../services/shipwayService');
const { authenticateToken, requireSuperadmin, requireVendor, requireAdminOrSuperadmin } = require('../middleware/auth');
const { 
  validateUserRegistration, 
  validateUserUpdate, 
  validateUserId, 
  validatePagination, 
  validateSearch 
} = require('../middleware/validation');

/**
 * User Management Routes
 * Handles CRUD operations for users (admin/vendor)
 * 
 * PERMISSION STRUCTURE:
 * =====================
 * 
 * SUPERADMIN (Full Master Access):
 * - Can CREATE, UPDATE, DELETE both VENDORS and ADMINS
 * - Uses general routes: POST /users, PUT /users/:id, DELETE /users/:id
 * - Cannot delete other superadmin users (safeguard in controller)
 * 
 * ADMIN (Limited Access - if implemented):
 * - Can CREATE, UPDATE, DELETE VENDORS ONLY (not other admins or superadmins)
 * - Uses vendor-specific routes: POST /users/vendor, PUT /users/vendor/:id, DELETE /users/vendor/:id
 * 
 * VENDOR:
 * - Can only view their own information
 * - Uses: GET /users/vendor/address
 */

// Apply authentication and authorization to all routes
router.use(authenticateToken);

/**
 * @route   GET /api/users/vendor/address
 * @desc    Get the vendor's warehouse address (for vendor panel)
 * @access  Vendor only
 */
router.get('/vendor/address', requireVendor, userController.getVendorAddress);

// Apply superadmin authorization to all other routes
router.post('/vendor', requireAdminOrSuperadmin, (req, res, next) => {
  // Force role to vendor for admin-created users
  req.body.role = 'vendor';
  next();
}, validateUserRegistration, userController.createUser);

/**
 * @route   GET /api/users/vendors-report
 * @desc    Get enriched vendor list with stats for admin panel
 * @access  Admin/Superadmin
 */
router.get('/vendors-report', requireAdminOrSuperadmin, async (req, res) => {
  try {
    const users = await database.getAllUsers();
    const vendors = users.filter(u => u.role === 'vendor');

    // Load orders for stats from MySQL
    let orders = [];
    try {
      orders = await database.getAllOrders();
    } catch (error) {
      console.log('Warning: Could not load orders for vendor stats:', error.message);
    }

    const buildVendor = async (v) => {
      // Stats
      const warehouseId = v.warehouseId || v.warehouse_id || v.warehouse || v.vendor_warehouse_id || v.warehouseid || '';
      const vOrders = warehouseId ? orders.filter(o => String(o.claimed_by) === String(warehouseId)) : [];
      const totalOrders = vOrders.length;
      const completedOrders = vOrders.filter(o => (o.status === 'delivered' || o.status === 'ready_for_handover')).length;
      const revenue = vOrders.reduce((sum, o) => sum + (parseFloat(o.order_total_split) || parseFloat(o.value) || 0), 0);

      // City from Shipway if not stored
      let city = v.city || v.vendor_city || '';
      if (!city && warehouseId) {
        try {
          const wh = await shipwayService.getWarehouseById(String(warehouseId));
          const formatted = shipwayService.formatWarehouseData(wh.data || wh);
          city = formatted.city || '';
        } catch (e) {
          city = '';
        }
      }

      // Normalize status
      let status = v.status || '';
      if (!status) {
        if (v.active === 'TRUE' || v.active === true) status = 'active';
        else if (v.active === 'FALSE' || v.active === false) status = 'inactive';
        else if (v.active_session === 'TRUE') status = 'active';
      }
      if (!status) status = 'inactive';

      return {
        id: v.id,
        name: v.name,
        email: v.email,
        phone: v.phone || '',
        warehouseId,
        city,
        status,
        totalOrders,
        completedOrders,
        revenue: revenue.toFixed(2),
      };
    };

    const enriched = [];
    for (const v of vendors) {
      // Sequential to avoid hammering Shipway; can be optimized if needed
      /* eslint-disable no-await-in-loop */
      const item = await buildVendor(v);
      enriched.push(item);
      /* eslint-enable no-await-in-loop */
    }

    return res.json({ success: true, data: { vendors: enriched } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to build vendors report', error: err.message });
  }
});

// Admin or Superadmin can update vendor via vendor-specific route
router.put('/vendor/:id', requireAdminOrSuperadmin, validateUserId, async (req, res, next) => {
  try {
    const id = req.params.id;
    const user = await database.getUserById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.role !== 'vendor') {
      return res.status(403).json({ success: false, message: 'Only vendor updates allowed via this endpoint' });
    }
    // Prevent changing role via this endpoint
    if (req.body && req.body.role && req.body.role !== 'vendor') {
      return res.status(400).json({ success: false, message: 'Cannot change role via vendor endpoint' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}, validateUserUpdate, userController.updateUser);

// Admin or Superadmin can delete vendor via vendor-specific route
router.delete('/vendor/:id', requireAdminOrSuperadmin, validateUserId, async (req, res, next) => {
  try {
    const id = req.params.id;
    const user = await database.getUserById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.role !== 'vendor') {
      return res.status(403).json({ success: false, message: 'Only vendor deletion allowed via this endpoint' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}, userController.deleteUser);

// Apply superadmin authorization to the remaining admin-only user routes
router.use(requireSuperadmin);

/**
 * @route   POST /api/users
 * @desc    Create a new user (admin or vendor)
 * @access  Superadmin only
 */
router.post('/', validateUserRegistration, userController.createUser);

/**
 * @route   GET /api/users
 * @desc    Get all users with pagination and filtering
 * @access  Superadmin only
 */
router.get('/', validatePagination, validateSearch, userController.getAllUsers);

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Superadmin only
 */
router.get('/:id', validateUserId, userController.getUserById);

/**
 * @route   PUT /api/users/:id
 * @desc    Update user
 * @access  Superadmin only
 */
router.put('/:id', validateUserId, validateUserUpdate, userController.updateUser);

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user
 * @access  Superadmin only
 */
router.delete('/:id', validateUserId, userController.deleteUser);

/**
 * @route   GET /api/users/role/:role
 * @desc    Get users by role (admin or vendor)
 * @access  Superadmin only
 */
router.get('/role/:role', userController.getUsersByRole);

/**
 * @route   GET /api/users/status/:status
 * @desc    Get users by status (active or inactive)
 * @access  Superadmin only
 */
router.get('/status/:status', userController.getUsersByStatus);

/**
 * @route   PATCH /api/users/:id/toggle-status
 * @desc    Toggle user status (active/inactive)
 * @access  Superadmin only
 */
router.patch('/:id/toggle-status', validateUserId, userController.toggleUserStatus);

module.exports = router; 