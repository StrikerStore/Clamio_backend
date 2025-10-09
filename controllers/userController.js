const database = require('../config/database');
const { hashPassword } = require('../middleware/auth');
const shipwayService = require('../services/shipwayService');
const fs = require('fs');
const path = require('path');

/**
 * User Management Controller
 * Handles user CRUD operations for superadmin
 */
class UserController {
  /**
   * Create a new user (admin or vendor)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createUser(req, res) {
    try {
      console.log('🔍 Backend: Creating user with request body:', {
        ...req.body,
        password: '***hidden***'
      });

      const {
        name,
        email,
        phone,
        password,
        role,
        status = 'active',
        warehouseId,
        contactNumber
      } = req.body;

      console.log('📋 Backend: Extracted user data:', {
        name,
        email,
        phone,
        role,
        status,
        warehouseId,
        contactNumber: contactNumber ? '***provided***' : 'not provided'
      });

      // Validate role-specific requirements
      if (role === 'vendor' && !warehouseId) {
        return res.status(400).json({
          success: false,
          message: 'Warehouse ID is required for vendors'
        });
      }

      if (role === 'admin' && !contactNumber) {
        return res.status(400).json({
          success: false,
          message: 'Contact number is required for admins'
        });
      }

      if (role === 'vendor' && warehouseId) {
        try {
          console.log('🔍 Creating vendor with warehouse ID:', warehouseId);

          if (!shipwayService.validateWarehouseId(warehouseId)) {
            console.log('❌ Invalid warehouse ID format:', warehouseId);
            return res.status(400).json({
              success: false,
              message: 'Invalid warehouse ID format'
            });
          }

          console.log('✅ Warehouse ID format is valid, validating with Shipway API...');
          const warehouseData = await shipwayService.getWarehouseById(warehouseId);
          
          console.log('📦 Shipway API response for user creation:', {
            success: warehouseData.success,
            hasData: !!warehouseData.data
          });

          if (!warehouseData.success) {
            console.log('❌ Warehouse not found in Shipway system:', warehouseId);
            return res.status(400).json({
              success: false,
              message: 'Invalid warehouse ID or warehouse not found in Shipway system'
            });
          }

          const formattedWarehouse = shipwayService.formatWarehouseData(warehouseData.data);
          console.log('✅ Warehouse validated, creating user with address:', {
            address: formattedWarehouse.address,
            city: formattedWarehouse.city,
            pincode: formattedWarehouse.pincode
          });

          const hashedPassword = await hashPassword(password);

          // Save address, city, pincode as top-level fields
          const userData = {
            name,
            email,
            phone,
            password: hashedPassword,
            role,
            status,
            warehouseId,
            address: formattedWarehouse.address,
            city: formattedWarehouse.city,
            pincode: formattedWarehouse.pincode,
            contactNumber
          };

          console.log('💾 Creating user in database...');
          const newUser = await database.createUser(userData);

          console.log('✅ User created successfully:', {
            id: newUser.id,
            name: newUser.name,
            role: newUser.role,
            warehouseId: newUser.warehouseId
          });

          res.status(201).json({
            success: true,
            message: `${role} created successfully`,
            data: newUser
          });

        } catch (shipwayError) {
          console.error('❌ Shipway API error during user creation:', shipwayError);
          console.error('Error details:', {
            message: shipwayError.message,
            stack: shipwayError.stack,
            warehouseId
          });

          // Handle specific error cases
          if (shipwayError.message.includes('Warehouse not found') || 
              shipwayError.message.includes('not found') ||
              shipwayError.message.includes('Invalid warehouse ID')) {
            return res.status(400).json({
              success: false,
              message: 'Invalid warehouse ID or warehouse not found in Shipway system'
            });
          }

          if (shipwayError.message.includes('API key') || 
              shipwayError.message.includes('credentials') ||
              shipwayError.message.includes('configuration')) {
            return res.status(500).json({
              success: false,
              message: 'Shipway API configuration error. Please contact administrator.'
            });
          }

          if (shipwayError.message.includes('connect') || 
              shipwayError.message.includes('timeout') ||
              shipwayError.message.includes('ECONNREFUSED') ||
              shipwayError.message.includes('ENOTFOUND')) {
            return res.status(503).json({
              success: false,
              message: 'Shipway API is currently unavailable. Please try again later.'
            });
          }

          return res.status(400).json({
            success: false,
            message: `Failed to validate warehouse: ${shipwayError.message}`
          });
        }
      } else {
        // For admins or users without warehouse
        const hashedPassword = await hashPassword(password);
        const userData = {
          name,
          email,
          phone,
          password: hashedPassword,
          role,
          status,
          warehouseId,
          contactNumber
        };
        const newUser = await database.createUser(userData);
        res.status(201).json({
          success: true,
          message: `${role} created successfully`,
          data: newUser
        });
      }
    } catch (error) {
      console.error('Create user error:', error);
      if (error.message.includes('already exists')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get all users with pagination and filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllUsers(req, res) {
    try {
      const { page = 1, limit = 10, role, status, q: searchQuery } = req.query;
      
      let users = await database.getAllUsers();

      // Filter by role
      if (role) {
        users = users.filter(user => user.role === role);
      }

      // Filter by status
      if (status) {
        users = users.filter(user => user.status === status);
      }

      // Search functionality
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        users = users.filter(user => 
          user.name.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query) ||
          (user.phone && user.phone.includes(query))
        );
      }

      // Remove superadmin from results (optional - for security)
      users = users.filter(user => user.role !== 'superadmin');

      // Pagination
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = pageNum * limitNum;
      
      const paginatedUsers = users.slice(startIndex, endIndex);
      const totalUsers = users.length;
      const totalPages = Math.ceil(totalUsers / limitNum);

      // Remove passwords from response
      const usersWithoutPasswords = paginatedUsers.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });

      res.json({
        success: true,
        data: {
          users: usersWithoutPasswords,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalUsers,
            hasNextPage: endIndex < totalUsers,
            hasPrevPage: pageNum > 1
          }
        }
      });

    } catch (error) {
      console.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get user by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUserById(req, res) {
    try {
      const { id } = req.params;

      const user = await database.getUserById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Remove password from response
      const { password, ...userWithoutPassword } = user;

      res.json({
        success: true,
        data: userWithoutPassword
      });

    } catch (error) {
      console.error('Get user by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Update user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const existingUser = await database.getUserById(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      // Handle role changes and warehouse ID requirements
      if (updateData.role === 'vendor') {
        // If changing to vendor role, warehouse ID is required
        if (!updateData.warehouseId) {
          return res.status(400).json({
            success: false,
            message: 'Warehouse ID is required for vendor role'
          });
        }
        
        // Validate warehouse ID for vendor role
        try {
          if (!shipwayService.validateWarehouseId(updateData.warehouseId)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid warehouse ID format'
            });
          }
          const warehouseData = await shipwayService.getWarehouseById(updateData.warehouseId);
          if (!warehouseData.success) {
            return res.status(400).json({
              success: false,
              message: 'Invalid warehouse ID or warehouse not found'
            });
          }
          const formattedWarehouse = shipwayService.formatWarehouseData(warehouseData.data);
          updateData.address = formattedWarehouse.address;
          updateData.city = formattedWarehouse.city;
          updateData.pincode = formattedWarehouse.pincode;
        } catch (shipwayError) {
          console.error('Shipway API error:', shipwayError);
          return res.status(400).json({
            success: false,
            message: `Failed to validate warehouse: ${shipwayError.message}`
          });
        }
      } else if (updateData.role === 'admin') {
        // If changing to admin role, clear warehouse-related fields
        updateData.warehouseId = null;
        updateData.address = null;
        updateData.city = null;
        updateData.pincode = null;
      } else if (updateData.warehouseId && existingUser.role === 'vendor') {
        // If updating warehouse ID for existing vendor
        try {
          if (!shipwayService.validateWarehouseId(updateData.warehouseId)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid warehouse ID format'
            });
          }
          const warehouseData = await shipwayService.getWarehouseById(updateData.warehouseId);
          if (!warehouseData.success) {
            return res.status(400).json({
              success: false,
              message: 'Invalid warehouse ID or warehouse not found'
            });
          }
          const formattedWarehouse = shipwayService.formatWarehouseData(warehouseData.data);
          updateData.address = formattedWarehouse.address;
          updateData.city = formattedWarehouse.city;
          updateData.pincode = formattedWarehouse.pincode;
        } catch (shipwayError) {
          console.error('Shipway API error:', shipwayError);
          return res.status(400).json({
            success: false,
            message: `Failed to validate warehouse: ${shipwayError.message}`
          });
        }
      }
      const prevUser = await database.getUserById(id);
      const updatedUser = await database.updateUser(id, updateData);
      if (!updatedUser) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update user'
        });
      }

      // If vendor warehouseId changed or status became inactive, update their orders' claim state
      try {
        if (updatedUser.role === 'vendor') {
          const prevWid = String((prevUser && (prevUser.warehouseId || prevUser.warehouse_id)) || '');
          const newWid = String((updatedUser.warehouseId || updatedUser.warehouse_id) || '');
          const deactivated = updateData.status && String(updateData.status).toLowerCase() === 'inactive';
          const warehouseChanged = prevWid && newWid && prevWid !== newWid;

          if (deactivated || warehouseChanged) {
            // Get all orders claimed by this vendor from MySQL
            const vendorOrders = await database.getOrdersByVendor(prevWid);
            const targetWid = warehouseChanged ? prevWid : newWid || prevWid;

            // Update each order to unclaimed status
            for (const order of vendorOrders) {
              await database.updateOrder(order.unique_id, {
                status: 'unclaimed',
                claimed_by: null,
                claimed_at: null
              });
            }

            console.log(`Updated ${vendorOrders.length} orders for vendor ${targetWid}`);
          }
        }
      } catch (e) {
        console.error('Error updating vendor orders on user update:', e);
        // Continue even if this fails
      }
      res.json({
        success: true,
        message: 'User updated successfully',
        data: updatedUser
      });
    } catch (error) {
      console.error('Update user error:', error);
      if (error.message.includes('already exists')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Delete user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteUser(req, res) {
    try {
      const { id } = req.params;

      // Check if user exists
      const user = await database.getUserById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // SAFEGUARD: Prevent deletion of superadmin users
      // This is a security measure to prevent accidental system lockout
      // Superadmin can delete vendors and admins, but not other superadmins
      if (user.role === 'superadmin') {
        return res.status(403).json({
          success: false,
          message: 'Cannot delete superadmin user. This is a security safeguard to prevent system lockout.'
        });
      }

      // If vendor, unclaim all orders assigned to this vendor before deleting
      if (user.role === 'vendor') {
        try {
          const vendorWid = String(user.warehouseId || user.warehouse_id || '');
          if (vendorWid) {
            // Get all orders claimed by this vendor from MySQL
            const vendorOrders = await database.getOrdersByVendor(vendorWid);
            
            // Update each order to unclaimed status
            for (const order of vendorOrders) {
              await database.updateOrder(order.unique_id, {
                status: 'unclaimed',
                claimed_by: null,
                claimed_at: null
                // Keep history in last_claimed_by/at as-is
              });
            }

            console.log(`Unclaimed ${vendorOrders.length} orders for deleted vendor ${vendorWid}`);
          }
        } catch (e) {
          console.error('Error unclaiming orders for deleted vendor:', e);
          // Continue with deletion even if this fails
        }
      }

      // Delete user
      const deleted = await database.deleteUser(id);

      if (!deleted) {
        return res.status(500).json({
          success: false,
          message: 'Failed to delete user'
        });
      }

      res.json({
        success: true,
        message: 'User deleted successfully'
      });

    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get users by role
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUsersByRole(req, res) {
    try {
      const { role } = req.params;

      if (!['admin', 'vendor'].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role. Must be admin or vendor'
        });
      }

      const users = await database.getUsersByRole(role);

      // Remove passwords from response
      const usersWithoutPasswords = users.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });

      res.json({
        success: true,
        data: usersWithoutPasswords
      });

    } catch (error) {
      console.error('Get users by role error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get users by status
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUsersByStatus(req, res) {
    try {
      const { status } = req.params;

      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status. Must be active or inactive'
        });
      }

      const users = await database.getUsersByStatus(status);

      // Remove passwords from response
      const usersWithoutPasswords = users.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });

      res.json({
        success: true,
        data: usersWithoutPasswords
      });

    } catch (error) {
      console.error('Get users by status error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Toggle user status (active/inactive)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async toggleUserStatus(req, res) {
    try {
      const { id } = req.params;

      const user = await database.getUserById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const newStatus = user.status === 'active' ? 'inactive' : 'active';
      const updatedUser = await database.updateUser(id, { status: newStatus });

      if (!updatedUser) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update user status'
        });
      }

      res.json({
        success: true,
        message: `User status changed to ${newStatus}`,
        data: updatedUser
      });

    } catch (error) {
      console.error('Toggle user status error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get the vendor's warehouse address (for vendor panel)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getVendorAddress(req, res) {
    try {
      const logDir = path.join(__dirname, '../logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logPath = path.join(logDir, 'vendor-debug.log');
      const timestamp = new Date().toISOString();
      const vendor = req.user;
      // Log the incoming user object and all relevant fields
      const logEntry = `[${timestamp}] vendor: ${JSON.stringify(vendor)}\n`;
      fs.appendFileSync(logPath, logEntry);
      const role = (vendor?.role || '').trim();
      const warehouseId = (vendor?.warehouseId || '').toString().trim();
      const address = (vendor?.address || '').trim();
      const city = (vendor?.city || '').trim();
      const pincode = (vendor?.pincode || '').toString().trim();
      fs.appendFileSync(logPath, `[${timestamp}] role: '${role}', warehouseId: '${warehouseId}', address: '${address}', city: '${city}', pincode: '${pincode}'\n`);
      if (!vendor || role !== 'vendor') {
        fs.appendFileSync(logPath, `[${timestamp}] result: 403 (role check failed)\n`);
        return res.status(403).json({
          success: false,
          message: 'Access denied. Only vendors can access this endpoint.'
        });
      }
      if (!warehouseId || !address || !city || !pincode) {
        fs.appendFileSync(logPath, `[${timestamp}] result: 404 (missing field)\n`);
        return res.status(404).json({
          success: false,
          message: 'Warehouse address not found for this vendor.'
        });
      }
      fs.appendFileSync(logPath, `[${timestamp}] result: 200 (success)\n`);
      res.json({
        success: true,
        data: {
          warehouseId,
          address,
          city,
          pincode
        }
      });
    } catch (error) {
      console.error('Get vendor address error:', error);
      fs.appendFileSync(path.join(__dirname, '../logs/vendor-debug.log'), `[${new Date().toISOString()}] error: ${error.message}\n`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

module.exports = new UserController(); 