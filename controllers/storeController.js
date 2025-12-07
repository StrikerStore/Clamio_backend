/**
 * Store Controller
 * Handles all store management operations (Superadmin only)
 */

const database = require('../config/database');
const encryptionService = require('../services/encryptionService');
const { generateUniqueAccountCode } = require('../utils/accountCodeGenerator');
const axios = require('axios');
const multiStoreSyncService = require('../services/multiStoreSyncService');

class StoreController {
  /**
   * Get all stores
   */
  async getAllStores(req, res) {
    try {
      const stores = await database.getAllStores();
      
      // Remove sensitive data before sending to frontend
      const sanitizedStores = stores.map(store => ({
        id: store.id,
        account_code: store.account_code,
        store_name: store.store_name,
        username: store.username,
        shopify_store_url: store.shopify_store_url,
        status: store.status,
        created_at: store.created_at,
        updated_at: store.updated_at,
        created_by: store.created_by,
        last_synced_at: store.last_synced_at,
        last_shopify_sync_at: store.last_shopify_sync_at,
        has_credentials: true // Indicate credentials exist without exposing them
      }));
      
      res.json({
        success: true,
        data: sanitizedStores
      });
      
    } catch (error) {
      console.error('Get all stores error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch stores',
        error: error.message
      });
    }
  }

  /**
   * Get store by account code
   */
  async getStoreByCode(req, res) {
    try {
      const { accountCode } = req.params;
      
      const store = await database.getStoreByAccountCode(accountCode);
      
      if (!store) {
        return res.status(404).json({
          success: false,
          message: 'Store not found'
        });
      }
      
      // Remove sensitive data
      const sanitizedStore = {
        id: store.id,
        account_code: store.account_code,
        store_name: store.store_name,
        username: store.username,
        shopify_store_url: store.shopify_store_url,
        status: store.status,
        created_at: store.created_at,
        updated_at: store.updated_at,
        created_by: store.created_by,
        last_synced_at: store.last_synced_at,
        last_shopify_sync_at: store.last_shopify_sync_at,
        has_credentials: true
      };
      
      res.json({
        success: true,
        data: sanitizedStore
      });
      
    } catch (error) {
      console.error('Get store error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch store',
        error: error.message
      });
    }
  }

  /**
   * Get store list for filtering (Admin/Superadmin accessible)
   * Returns only account_code and store_name
   */
  async getStoreListForFilter(req, res) {
    try {
      const stores = await database.getAllStores();
      
      // Return only essential fields for filtering
      const storeList = stores.map(store => ({
        account_code: store.account_code,
        store_name: store.store_name,
        status: store.status
      }));
      
      res.json({
        success: true,
        data: storeList
      });
      
    } catch (error) {
      console.error('Get store list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch store list',
        error: error.message
      });
    }
  }

  /**
   * Create new store
   */
  async createStore(req, res) {
    try {
      const { 
        store_name,
        shipping_partner,
        username, 
        password, 
        shopify_store_url, 
        shopify_token,
        status
      } = req.body;
      
      // Validation - ALL FIELDS REQUIRED
      if (!store_name) {
        return res.status(400).json({
          success: false,
          message: 'Store name is required'
        });
      }
      
      if (!shipping_partner) {
        return res.status(400).json({
          success: false,
          message: 'Shipping partner is required'
        });
      }
      
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: 'Username and password are required'
        });
      }
      
      if (!shopify_store_url || !shopify_token) {
        return res.status(400).json({
          success: false,
          message: 'Shopify store URL and token are required'
        });
      }
      
      if (!status || !['active', 'inactive'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status must be either "active" or "inactive"'
        });
      }
      
      // Generate unique account_code from store_name
      const accountCode = await generateUniqueAccountCode(store_name, database);
      console.log(`✅ Generated account code: ${accountCode} for store: ${store_name}`);
      
      // Encrypt password
      const encryptedPassword = encryptionService.encrypt(password);
      
      // Generate Basic Auth token
      const authToken = Buffer.from(`${username}:${password}`).toString('base64');
      
      // Create store
      await database.createStore({
        account_code: accountCode,
        store_name: store_name,
        shipping_partner: shipping_partner,
        username: username,
        password_encrypted: encryptedPassword,
        auth_token: `Basic ${authToken}`,
        shopify_store_url: shopify_store_url,
        shopify_token: shopify_token,
        status: status,
        created_by: req.user.id
      });
      
      console.log(`✅ Store created: ${store_name} (${accountCode})`);

      // Immediately sync this new store (orders, carriers, products) using multi-store sync service
      let syncResult = null;
      try {
        console.log(`🚀 Triggering initial sync for new store: ${accountCode}`);
        syncResult = await multiStoreSyncService.syncStore(accountCode);
        console.log(`✅ Initial sync completed for new store: ${accountCode}`);
      } catch (syncError) {
        console.error(`⚠️ Initial sync failed for new store ${accountCode}:`, syncError.message);
        // Don't fail store creation if sync fails – just report it in response
        syncResult = {
          success: false,
          error: syncError.message
        };
      }
      
      res.json({
        success: true,
        message: 'Store created successfully',
        data: {
          account_code: accountCode,
          store_name: store_name,
          status: status,
          sync_result: syncResult
        }
      });
      
    } catch (error) {
      console.error('Create store error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create store',
        error: error.message
      });
    }
  }

  /**
   * Update store
   */
  async updateStore(req, res) {
    try {
      const { accountCode } = req.params;
      const { 
        store_name, 
        username, 
        password, 
        shopify_store_url, 
        shopify_token,
        status
      } = req.body;
      
      // Check if store exists
      const existingStore = await database.getStoreByAccountCode(accountCode);
      if (!existingStore) {
        return res.status(404).json({
          success: false,
          message: 'Store not found'
        });
      }
      
      // Build update object
      const updateData = {};
      
      if (store_name !== undefined) {
        updateData.store_name = store_name;
      }
      
      if (username !== undefined) {
        updateData.username = username;
      }
      
      // Handle password update and auth token regeneration
      if (password !== undefined && password !== '') {
        // Encrypt new password
        updateData.password_encrypted = encryptionService.encrypt(password);
        
        // Regenerate auth token with new password
        const currentUsername = username !== undefined ? username : existingStore.username;
        updateData.auth_token = `Basic ${Buffer.from(`${currentUsername}:${password}`).toString('base64')}`;
      } else if (username !== undefined && username !== existingStore.username) {
        // Username changed but password not provided - regenerate auth token with existing password
        if (existingStore.password_encrypted) {
          try {
            const existingPassword = encryptionService.decrypt(existingStore.password_encrypted);
            updateData.auth_token = `Basic ${Buffer.from(`${username}:${existingPassword}`).toString('base64')}`;
          } catch (error) {
            console.error('Error decrypting existing password for auth token regeneration:', error);
            // Continue without regenerating auth token if decryption fails
          }
        }
      }
      
      if (shopify_store_url !== undefined) {
        updateData.shopify_store_url = shopify_store_url;
      }
      
      if (shopify_token !== undefined) {
        updateData.shopify_token = shopify_token;
      }
      
      if (status !== undefined) {
        if (!['active', 'inactive'].includes(status)) {
          return res.status(400).json({
            success: false,
            message: 'Status must be either "active" or "inactive"'
          });
        }
        updateData.status = status;
      }
      
      // Update store
      await database.updateStore(accountCode, updateData);
      
      console.log(`✅ Store updated: ${accountCode}`);
      
      res.json({
        success: true,
        message: 'Store updated successfully'
      });
      
    } catch (error) {
      console.error('Update store error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update store',
        error: error.message
      });
    }
  }

  /**
   * Delete store (soft delete - set status to inactive)
   */
  async deleteStore(req, res) {
    try {
      const { accountCode } = req.params;
      
      // Check if store exists
      const existingStore = await database.getStoreByAccountCode(accountCode);
      if (!existingStore) {
        return res.status(404).json({
          success: false,
          message: 'Store not found'
        });
      }
      
      // Soft delete by setting status to inactive
      await database.deleteStore(accountCode);
      
      console.log(`✅ Store deleted (soft): ${accountCode}`);
      
      res.json({
        success: true,
        message: 'Store deleted successfully'
      });
      
    } catch (error) {
      console.error('Delete store error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete store',
        error: error.message
      });
    }
  }

  /**
   * Toggle store status (active/inactive)
   */
  async toggleStoreStatus(req, res) {
    try {
      const { accountCode } = req.params;
      
      // Get current store
      const store = await database.getStoreByAccountCode(accountCode);
      if (!store) {
        return res.status(404).json({
          success: false,
          message: 'Store not found'
        });
      }
      
      // Toggle status
      const newStatus = store.status === 'active' ? 'inactive' : 'active';
      
      await database.updateStore(accountCode, { status: newStatus });
      
      console.log(`✅ Store status toggled: ${accountCode} -> ${newStatus}`);
      
      res.json({
        success: true,
        message: `Store ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
        data: {
          account_code: accountCode,
          status: newStatus
        }
      });
      
    } catch (error) {
      console.error('Toggle store status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to toggle store status',
        error: error.message
      });
    }
  }

  /**
   * Test Shipway connection
   */
  async testShipwayConnection(req, res) {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: 'Username and password are required'
        });
      }
      
      // Generate auth token
      const authToken = Buffer.from(`${username}:${password}`).toString('base64');
      
      // Test connection by calling Shipway API
      const response = await axios.get('https://app.shipway.com/api/getorders', {
        params: { status: 'O', page: 1 },
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      if (response.status === 200) {
        res.json({
          success: true,
          message: 'Shipway connection successful'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Shipway connection failed: Invalid response'
        });
      }
      
    } catch (error) {
      console.error('Test Shipway connection error:', error.message);
      
      if (error.response && error.response.status === 401) {
        res.status(401).json({
          success: false,
          message: 'Shipway connection failed: Invalid credentials'
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Shipway connection failed',
          error: error.message
        });
      }
    }
  }

  /**
   * Test Shopify connection
   */
  async testShopifyConnection(req, res) {
    try {
      const { shopify_store_url, shopify_token } = req.body;
      
      if (!shopify_store_url || !shopify_token) {
        return res.status(400).json({
          success: false,
          message: 'Shopify store URL and token are required'
        });
      }
      
      // Normalize the Shopify store URL
      let normalizedUrl = shopify_store_url.trim();
      
      // Remove protocol if present
      normalizedUrl = normalizedUrl.replace(/^https?:\/\//, '');
      
      // Remove trailing slash
      normalizedUrl = normalizedUrl.replace(/\/$/, '');
      
      // Remove /admin path if present
      normalizedUrl = normalizedUrl.replace(/\/admin.*$/, '');
      
      // Construct the API URL
      const apiUrl = `https://${normalizedUrl}/admin/api/2024-01/shop.json`;
      
      console.log(`[Test Shopify] Testing connection to: ${apiUrl}`);
      
      // Test connection by calling Shopify API
      const response = await axios.get(apiUrl, {
        headers: {
          'X-Shopify-Access-Token': shopify_token
        },
        timeout: 10000
      });
      
      if (response.status === 200 && response.data.shop) {
        res.json({
          success: true,
          message: 'Shopify connection successful',
          data: {
            shop_name: response.data.shop.name,
            domain: response.data.shop.domain
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Shopify connection failed: Invalid response'
        });
      }
      
    } catch (error) {
      console.error('Test Shopify connection error:', error.message);
      
      if (error.response) {
        // Handle different HTTP error statuses
        const status = error.response.status;
        const statusText = error.response.statusText;
        
        if (status === 401) {
          return res.status(401).json({
            success: false,
            message: 'Shopify connection failed: Invalid token or unauthorized access'
          });
        } else if (status === 404) {
          return res.status(404).json({
            success: false,
            message: 'Shopify connection failed: Store not found. Please check the store URL.'
          });
        } else if (status === 403) {
          return res.status(403).json({
            success: false,
            message: 'Shopify connection failed: Access forbidden. Please check your token permissions.'
          });
        } else {
          return res.status(status).json({
            success: false,
            message: `Shopify connection failed: ${statusText || 'HTTP error'} (${status})`
          });
        }
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return res.status(500).json({
          success: false,
          message: 'Shopify connection failed: Unable to reach Shopify server. Please check the store URL.'
        });
      } else if (error.code === 'ETIMEDOUT') {
        return res.status(500).json({
          success: false,
          message: 'Shopify connection failed: Request timed out. Please try again.'
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Shopify connection failed',
          error: error.message
        });
      }
    }
  }

  /**
   * Sync all active stores in parallel
   */
  async syncAllStores(req, res) {
    try {
      const { concurrencyLimit } = req.body;
      
      console.log('🚀 Triggering multi-store sync...');
      
      // Start sync (this may take a while)
      const result = await multiStoreSyncService.syncAllStores(concurrencyLimit);
      
      res.json({
        success: true,
        message: 'Multi-store sync completed',
        data: result
      });
      
    } catch (error) {
      console.error('Sync all stores error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to sync stores',
        error: error.message
      });
    }
  }

  /**
   * Get all available shipping partners
   */
  async getShippingPartners(req, res) {
    try {
      const shippingPartners = await database.getShippingPartners();
      
      res.json({
        success: true,
        data: shippingPartners
      });
      
    } catch (error) {
      console.error('Get shipping partners error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch shipping partners',
        error: error.message
      });
    }
  }

  /**
   * Sync a single store
   */
  async syncSingleStore(req, res) {
    try {
      const { accountCode } = req.params;
      
      console.log(`🚀 Triggering sync for store: ${accountCode}`);
      
      const result = await multiStoreSyncService.syncStore(accountCode);
      
      if (result.success) {
        res.json({
          success: true,
          message: `Store ${accountCode} synced successfully`,
          data: result
        });
      } else {
        res.status(500).json({
          success: false,
          message: `Store ${accountCode} sync failed`,
          error: result.error
        });
      }
      
    } catch (error) {
      console.error('Sync single store error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to sync store',
        error: error.message
      });
    }
  }
}

module.exports = new StoreController();

