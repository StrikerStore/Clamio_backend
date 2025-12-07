const database = require('../config/database');

/**
 * Auto Manifest Service
 * Handles automatic manifest creation for orders that are handed over but not marked as ready
 * Now supports multi-store via account_code from orders
 */
class AutoManifestService {
  constructor() {
    this.isRunning = false;
    // Store credentials cache: account_code -> auth_token
    this.storeCredentialsCache = new Map();
  }

  /**
   * Get store credentials for a given account_code
   * @param {string} accountCode - The account_code to get credentials for
   * @returns {string} The auth_token for the store
   */
  async getStoreCredentials(accountCode) {
    if (!accountCode) {
      throw new Error('account_code is required for creating manifest');
    }

    // Check cache first
    if (this.storeCredentialsCache.has(accountCode)) {
      return this.storeCredentialsCache.get(accountCode);
    }

    // Fetch from database
    await database.waitForMySQLInitialization();
    const store = await database.getStoreByAccountCode(accountCode);
    
    if (!store) {
      throw new Error(`Store not found for account_code: ${accountCode}`);
    }
    
    if (store.status !== 'active') {
      throw new Error(`Store is not active: ${accountCode}`);
    }
    
    if (!store.auth_token) {
      throw new Error(`Store auth_token not found for account_code: ${accountCode}`);
    }

    // Cache the credentials
    this.storeCredentialsCache.set(accountCode, store.auth_token);
    
    return store.auth_token;
  }

  /**
   * Process auto-manifest for orders that need it
   * Called when is_handover becomes 1 but is_manifest is still 0
   */
  async processAutoManifest() {
    if (this.isRunning) {
      console.log('🔄 [Auto-Manifest] Process already running, skipping...');
      return { success: false, message: 'Auto-manifest process already in progress' };
    }

    this.isRunning = true;
    
    try {
      console.log('🚀 [Auto-Manifest] Starting auto-manifest process...');
      
      const database = require('../config/database');
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        throw new Error('Database connection not available');
      }

      // Get orders that need auto-manifest
      const ordersNeedingManifest = await database.getOrdersNeedingAutoManifest();
      console.log(`📦 [Auto-Manifest] Found ${ordersNeedingManifest.length} orders needing auto-manifest`);
      
      // Log details of orders that need manifesting
      if (ordersNeedingManifest.length > 0) {
        console.log('📋 [Auto-Manifest] Orders needing manifest:');
        ordersNeedingManifest.forEach((order, index) => {
          console.log(`  ${index + 1}. Order ${order.order_id} - ${order.customer_name} - ${order.product_name}`);
          console.log(`     Status: ${order.current_shipment_status}, Handover: ${order.is_handover}, AWB: ${order.awb || 'N/A'}`);
        });
      }

      if (ordersNeedingManifest.length === 0) {
        console.log('✅ [Auto-Manifest] No orders need auto-manifest');
        return {
          success: true,
          message: 'No orders need auto-manifest',
          processed: 0,
          successCount: 0,
          errorCount: 0
        };
      }

      // Group orders by account_code to process store-specific batches
      const ordersByStore = {};
      ordersNeedingManifest.forEach(order => {
        if (!order.account_code) {
          console.warn(`⚠️ [Auto-Manifest] Order ${order.order_id} missing account_code, skipping`);
          return;
        }
        if (!ordersByStore[order.account_code]) {
          ordersByStore[order.account_code] = [];
        }
        ordersByStore[order.account_code].push(order);
      });

      let successCount = 0;
      let errorCount = 0;

      // Process each store's orders separately
      for (const [accountCode, storeOrders] of Object.entries(ordersByStore)) {
        console.log(`🏪 [Auto-Manifest] Processing ${storeOrders.length} orders for store: ${accountCode}`);
        
        const batchSize = 10; // Batch size per store
        for (let i = 0; i < storeOrders.length; i += batchSize) {
          const batch = storeOrders.slice(i, i + batchSize);
          const orderIds = batch.map(order => order.order_id);
          
          console.log(`🔄 [Auto-Manifest] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(storeOrders.length/batchSize)} for store ${accountCode} (${batch.length} orders)`);
          console.log(`📦 [Auto-Manifest] Order IDs in batch: ${orderIds.join(', ')}`);
          
          try {
            // Collect AWB numbers for all orders in batch
            const orderDetails = batch.map(order => ({
              order_id: order.order_id,
              awb: order.awb,
              customer_name: order.customer_name,
              current_shipment_status: order.current_shipment_status
            }));
            
            console.log(`📦 [Auto-Manifest] Batch details:`);
            orderDetails.forEach(order => {
              console.log(`  - Order ${order.order_id}: AWB=${order.awb || 'N/A'}, Customer=${order.customer_name}, Status=${order.current_shipment_status}`);
            });
            
            // Call Shipway Create Manifest API with all orders in batch (store-specific)
            const manifestResponse = await this.callShipwayCreateManifestAPI(orderIds, orderDetails, accountCode);
          
          if (manifestResponse.success) {
            // Update database for all successful orders
            const database = require('../config/database');
            for (const orderId of orderIds) {
              try {
                // Set is_manifest = 1 in labels table
                await database.updateManifestStatus(orderId, true);
                
                // Update claim status to ready_for_handover for all products in this order
                const orders = await database.getAllOrders();
                const orderProducts = orders.filter(order => order.order_id === orderId);
                
                for (const product of orderProducts) {
                  await database.updateOrder(product.unique_id, {
                    status: 'ready_for_handover'
                  });
                }
                
                successCount++;
                console.log(`✅ [Auto-Manifest] Successfully created manifest and updated status for order ${orderId}`);
              } catch (dbError) {
                errorCount++;
                console.error(`❌ [Auto-Manifest] Failed to update database for order ${orderId}:`, dbError.message);
              }
            }
          } else {
            // If bulk API fails, try smart individual retry
            console.log(`⚠️ [Auto-Manifest] Bulk API failed, attempting smart individual retry...`);
            const retryResults = await this.smartIndividualRetry(batch);
            
            // Update counters based on retry results
            const successRetries = retryResults.filter(r => r.status === 'success' || r.status === 'already_manifested').length;
            const failedRetries = retryResults.filter(r => r.status === 'failed' || r.status === 'error').length;
            
            successCount += successRetries;
            errorCount += failedRetries;
          }
        } catch (error) {
          console.error(`❌ [Auto-Manifest] Batch processing failed:`, error.message);
          errorCount += batch.length;
        }

        // Small delay between batches to be respectful to the API
        if (i + batchSize < ordersNeedingManifest.length) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced delay since we're making fewer API calls
        }
      }

      console.log(`✅ [Auto-Manifest] Process completed: ${successCount} success, ${errorCount} errors`);
      
      return {
        success: true,
        message: 'Auto-manifest process completed',
        processed: ordersNeedingManifest.length,
        successCount,
        errorCount,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('💥 [Auto-Manifest] Process failed:', error.message);
      return {
        success: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process manifest for a single order
   * @param {Object} order - Order object with order_id and other details
   */
  async processSingleOrderManifest(order) {
    try {
      if (!order.account_code) {
        throw new Error(`Order ${order.order_id} missing account_code`);
      }

      console.log(`🔄 [Auto-Manifest] Processing order: ${order.order_id} (store: ${order.account_code})`);
      
      // Call Shipway Create Manifest API with store-specific credentials
      const manifestResponse = await this.callShipwayCreateManifestAPI([order.order_id], null, order.account_code);
      
      if (!manifestResponse.success) {
        throw new Error(`Manifest API failed: ${manifestResponse.message}`);
      }
      
      // Update is_manifest = 1 in database
      await database.updateManifestStatus(order.order_id, true);
      
      // Update claim status to ready_for_handover for all products in this order
      const orders = await database.getAllOrders();
      const orderProducts = orders.filter(o => o.order_id === order.order_id);
      
      for (const product of orderProducts) {
        await database.updateOrder(product.unique_id, {
          status: 'ready_for_handover'
        });
      }
      
      console.log(`✅ [Auto-Manifest] Successfully created manifest and updated status for order ${order.order_id}`);
      
      return {
        success: true,
        message: 'Manifest created successfully',
        orderId: order.order_id
      };
      
    } catch (error) {
      console.error(`❌ [Auto-Manifest] Failed to process order ${order.order_id}:`, error.message);
      return {
        success: false,
        message: error.message,
        orderId: order.order_id
      };
    }
  }

  /**
   * Call Shipway Create Manifest API (Bulk)
   * @param {Array} orderIds - Array of order IDs to manifest in bulk
   * @param {Array} orderDetails - Array of order details with AWB numbers (optional)
   * @param {string} accountCode - The account_code for the store
   */
  async callShipwayCreateManifestAPI(orderIds, orderDetails = null, accountCode = null) {
    try {
      if (!accountCode) {
        throw new Error('account_code is required for creating manifest');
      }

      console.log(`🔄 [Auto-Manifest] Calling Shipway Create Manifest API (Bulk) for store: ${accountCode}`);
      console.log(`📦 [Auto-Manifest] Processing ${orderIds.length} orders: ${orderIds.join(', ')}`);
      
      // Get store-specific credentials
      const basicAuthHeader = await this.getStoreCredentials(accountCode);

      const requestBody = {
        order_ids: orderIds
      };

      // If we have order details with AWB numbers, include them in the request
      if (orderDetails && orderDetails.length > 0) {
        const awbNumbers = orderDetails
          .filter(order => order.awb && order.awb.trim() !== '')
          .map(order => order.awb);
        
        if (awbNumbers.length > 0) {
          requestBody.awb_numbers = awbNumbers;
          console.log(`📦 [Auto-Manifest] Including AWB numbers: ${awbNumbers.join(', ')}`);
        }
      }

      console.log('📤 [Auto-Manifest] Bulk Manifest API Request:', requestBody);

      const response = await fetch('https://app.shipway.com/api/Createmanifest/', {
        method: 'POST',
        headers: {
          'Authorization': basicAuthHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        timeout: 30000
      });

      const data = await response.json();

      console.log('📦 [Auto-Manifest] Manifest API Response:', data);

      if (!response.ok || data.success !== 1) {
        throw new Error(`Shipway Create Manifest API error: ${data.message || response.statusText}`);
      }

      console.log(`✅ [Auto-Manifest] Shipway Create Manifest API call successful for ${orderIds.length} orders`);
      
      return {
        success: true,
        data: data,
        message: `Bulk manifest created successfully for ${orderIds.length} orders`,
        orderCount: orderIds.length
      };

    } catch (error) {
      console.error('❌ [Auto-Manifest] Shipway Create Manifest API call failed:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Smart individual retry - tries to identify which orders actually failed
   * @param {Array} batch - Array of orders that were in the failed batch
   * @returns {Array} Array of retry results with status for each order
   */
  async smartIndividualRetry(batch) {
    console.log(`🧠 [Auto-Manifest] Starting smart individual retry for ${batch.length} orders...`);
    
    const database = require('../config/database');
    const retryResults = [];
    
    // Try each order individually
    for (const order of batch) {
      try {
        console.log(`🔄 [Auto-Manifest] Retrying order ${order.order_id} individually...`);
        
        // Check if order is already manifested (might have succeeded in bulk but API didn't confirm)
        const existingLabel = await database.mysqlConnection.execute(
          'SELECT is_manifest FROM labels WHERE order_id = ?',
          [order.order_id]
        );
        
        if (existingLabel.length > 0 && existingLabel[0].is_manifest === 1) {
          console.log(`✅ [Auto-Manifest] Order ${order.order_id} already manifested, skipping retry`);
          retryResults.push({ orderId: order.order_id, status: 'already_manifested' });
          continue;
        }
        
        // Try individual manifest
        const individualResult = await this.processSingleOrderManifest(order);
        
        if (individualResult.success) {
          retryResults.push({ orderId: order.order_id, status: 'success' });
          console.log(`✅ [Auto-Manifest] Order ${order.order_id} retry successful`);
        } else {
          retryResults.push({ orderId: order.order_id, status: 'failed', reason: individualResult.message });
          console.log(`❌ [Auto-Manifest] Order ${order.order_id} retry failed: ${individualResult.message}`);
        }
        
      } catch (error) {
        retryResults.push({ orderId: order.order_id, status: 'error', reason: error.message });
        console.error(`❌ [Auto-Manifest] Order ${order.order_id} retry error:`, error.message);
      }
    }
    
    // Log summary of retry results
    const successRetries = retryResults.filter(r => r.status === 'success' || r.status === 'already_manifested').length;
    const failedRetries = retryResults.filter(r => r.status === 'failed' || r.status === 'error').length;
    
    console.log(`📊 [Auto-Manifest] Smart retry completed:`);
    console.log(`  - Successful: ${successRetries}`);
    console.log(`  - Failed: ${failedRetries}`);
    console.log(`  - Total processed: ${retryResults.length}`);
    
    return retryResults;
  }

  /**
   * Get auto-manifest process status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new AutoManifestService();
