const shipwayService = require('../services/shipwayService');

/**
 * Shipway API Controller
 * Handles warehouse data fetching and validation
 */
class ShipwayController {
  /**
   * Get warehouse details by warehouse ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getWarehouseById(req, res) {
    try {
      const { warehouseId } = req.params;
      const accountCode = req.query.account_code || req.body.account_code;

      if (!accountCode) {
        return res.status(400).json({
          success: false,
          message: 'account_code is required for warehouse validation'
        });
      }

      // Validate warehouse ID format
      const ShipwayService = require('../services/shipwayService');
      const tempService = new ShipwayService();
      if (!tempService.validateWarehouseId(warehouseId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid warehouse ID format. Must be a positive number.'
        });
      }

      // Create store-specific ShipwayService instance
      const shipwayServiceInstance = new ShipwayService(accountCode);
      await shipwayServiceInstance.initialize();

      // Fetch warehouse data from Shipway API
      const warehouseData = await shipwayServiceInstance.getWarehouseById(warehouseId);

      if (!warehouseData.success) {
        return res.status(404).json({
          success: false,
          message: 'Warehouse not found or invalid warehouse ID'
        });
      }

      // Format the warehouse data
      const formattedWarehouse = shipwayService.formatWarehouseData(warehouseData.data);

      res.json({
        success: true,
        message: 'Warehouse details retrieved successfully',
        data: {
          warehouseId,
          warehouse: formattedWarehouse,
          rawData: warehouseData.data // Include raw data for debugging
        }
      });

    } catch (error) {
      console.error('Get warehouse by ID error:', error);
      
      // Handle specific error cases
      if (error.message.includes('Warehouse not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      if (error.message.includes('API key')) {
        return res.status(500).json({
          success: false,
          message: 'Shipway API configuration error. Please contact administrator.'
        });
      }

      if (error.message.includes('connect') || error.message.includes('timeout')) {
        return res.status(503).json({
          success: false,
          message: 'Shipway API is currently unavailable. Please try again later.'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to fetch warehouse details'
      });
    }
  }

  /**
   * Validate warehouse ID format
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async validateWarehouseId(req, res) {
    try {
      const { warehouseId } = req.params;

      const isValid = shipwayService.validateWarehouseId(warehouseId);

      res.json({
        success: true,
        data: {
          warehouseId,
          isValid,
          message: isValid ? 'Valid warehouse ID format' : 'Invalid warehouse ID format'
        }
      });

    } catch (error) {
      console.error('Validate warehouse ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Test Shipway API connectivity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async testConnection(req, res) {
    try {
      const testResult = await shipwayService.testConnection();

      if (testResult.success) {
        res.json({
          success: true,
          message: 'Shipway API connection test successful',
          data: testResult
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Shipway API connection test failed',
          data: testResult
        });
      }

    } catch (error) {
      console.error('Test connection error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to test Shipway API connection',
        error: error.message
      });
    }
  }

  /**
   * Get warehouse details with validation for user creation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async validateWarehouseForUser(req, res) {
    try {
      const { warehouseId } = req.body;

      console.log('🔍 Validating warehouse for user:', warehouseId);

      if (!warehouseId) {
        return res.status(400).json({
          success: false,
          message: 'Warehouse ID is required'
        });
      }

      // Get account_code from request first
      const accountCode = req.body.account_code || req.query.account_code;
      
      if (!accountCode) {
        return res.status(400).json({
          success: false,
          message: 'account_code is required for warehouse validation'
        });
      }

      // Validate warehouse ID format
      const ShipwayService = require('../services/shipwayService');
      const tempService = new ShipwayService();
      if (!tempService.validateWarehouseId(warehouseId)) {
        console.log('❌ Invalid warehouse ID format:', warehouseId);
        return res.status(400).json({
          success: false,
          message: 'Invalid warehouse ID format. Must be a positive number.'
        });
      }

      console.log('✅ Warehouse ID format is valid, fetching from Shipway API...');

      // Create store-specific ShipwayService instance (accountCode already declared above)
      const shipwayServiceInstance = new ShipwayService(accountCode);
      await shipwayServiceInstance.initialize();

      // Fetch warehouse data from Shipway API
      const warehouseData = await shipwayServiceInstance.getWarehouseById(warehouseId);

      console.log('📦 Shipway API response:', {
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

      // Format the warehouse data
      const formattedWarehouse = shipwayServiceInstance.formatWarehouseData(warehouseData.data);

      console.log('✅ Warehouse validated successfully:', {
        warehouseId,
        address: formattedWarehouse.address,
        city: formattedWarehouse.city,
        pincode: formattedWarehouse.pincode
      });

      res.json({
        success: true,
        message: 'Warehouse validated successfully',
        data: {
          warehouseId,
          warehouse: formattedWarehouse,
          isValid: true
        }
      });

    } catch (error) {
      // Handle expected validation failures (warehouse not found) without logging as errors
      if (error.message.includes('Warehouse not found') || 
          error.message.includes('not found') ||
          error.message.includes('Invalid warehouse ID')) {
        console.log('⚠️ Warehouse validation failed (expected):', {
          warehouseId: req.body.warehouseId,
          reason: error.message
        });
        return res.status(400).json({
          success: false,
          message: 'Invalid warehouse ID or warehouse not found in Shipway system'
        });
      }

      // Log actual system errors
      console.error('❌ Validate warehouse for user error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        warehouseId: req.body.warehouseId
      });

      if (error.message.includes('API key') || 
          error.message.includes('credentials') ||
          error.message.includes('configuration')) {
        return res.status(500).json({
          success: false,
          message: 'Shipway API configuration error. Please contact administrator.'
        });
      }

      if (error.message.includes('connect') || 
          error.message.includes('timeout') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ENOTFOUND')) {
        return res.status(503).json({
          success: false,
          message: 'Shipway API is currently unavailable. Please try again later.'
        });
      }

      res.status(500).json({
        success: false,
        message: `Failed to validate warehouse: ${error.message}`
      });
    }
  }

  /**
   * Get multiple warehouses by IDs
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getMultipleWarehouses(req, res) {
    try {
      const { warehouseIds } = req.body;

      if (!warehouseIds || !Array.isArray(warehouseIds)) {
        return res.status(400).json({
          success: false,
          message: 'Warehouse IDs array is required'
        });
      }

      if (warehouseIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one warehouse ID is required'
        });
      }

      if (warehouseIds.length > 10) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 10 warehouse IDs allowed per request'
        });
      }

      const results = [];
      const errors = [];

      // Get account_code from request
      const accountCode = req.body.account_code || req.query.account_code;
      
      if (!accountCode) {
        return res.status(400).json({
          success: false,
          message: 'account_code is required for warehouse validation'
        });
      }

      // Create store-specific ShipwayService instance
      const ShipwayService = require('../services/shipwayService');
      const shipwayServiceInstance = new ShipwayService(accountCode);
      await shipwayServiceInstance.initialize();

      // Fetch each warehouse
      for (const warehouseId of warehouseIds) {
        try {
          // Validate warehouse ID format
          if (!shipwayServiceInstance.validateWarehouseId(warehouseId)) {
            errors.push({
              warehouseId,
              error: 'Invalid warehouse ID format'
            });
            continue;
          }

          // Fetch warehouse data
          const warehouseData = await shipwayServiceInstance.getWarehouseById(warehouseId);

          if (warehouseData.success) {
            const formattedWarehouse = shipwayServiceInstance.formatWarehouseData(warehouseData.data);
            results.push({
              warehouseId,
              warehouse: formattedWarehouse,
              success: true
            });
          } else {
            errors.push({
              warehouseId,
              error: 'Warehouse not found'
            });
          }

        } catch (error) {
          errors.push({
            warehouseId,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        message: `Processed ${warehouseIds.length} warehouse IDs`,
        data: {
          results,
          errors,
          summary: {
            total: warehouseIds.length,
            successful: results.length,
            failed: errors.length
          }
        }
      });

    } catch (error) {
      console.error('Get multiple warehouses error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch multiple warehouses'
      });
    }
  }

  /**
   * Get warehouse statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getWarehouseStats(req, res) {
    try {
      // This endpoint can be used to get warehouse statistics
      // For now, we'll return basic API status
      const testResult = await shipwayService.testConnection();

      res.json({
        success: true,
        message: 'Warehouse API statistics',
        data: {
          apiStatus: testResult.success ? 'connected' : 'disconnected',
          lastChecked: new Date().toISOString(),
          features: [
            'Warehouse validation',
            'Warehouse details fetching',
            'Multiple warehouse processing'
          ]
        }
      });

    } catch (error) {
      console.error('Get warehouse stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get warehouse statistics'
      });
    }
  }
}

module.exports = new ShipwayController(); 