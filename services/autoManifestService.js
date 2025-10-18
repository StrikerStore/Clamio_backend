/**
 * Auto Manifest Service
 * Handles automatic manifest creation for orders that are handed over but not marked as ready
 */
class AutoManifestService {
  constructor() {
    this.isRunning = false;
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

      let successCount = 0;
      let errorCount = 0;

      // Process orders in batches to avoid overwhelming the API
      const batchSize = 5;
      for (let i = 0; i < ordersNeedingManifest.length; i += batchSize) {
        const batch = ordersNeedingManifest.slice(i, i + batchSize);
        
        console.log(`🔄 [Auto-Manifest] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(ordersNeedingManifest.length/batchSize)} (${batch.length} orders)`);
        
        // Process batch in parallel
        const batchPromises = batch.map(order => this.processSingleOrderManifest(order));
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.success) {
            successCount++;
            console.log(`✅ [Auto-Manifest] Successfully processed order ${batch[index].order_id}`);
          } else {
            errorCount++;
            const errorMsg = result.status === 'fulfilled' ? result.value.message : result.reason.message;
            console.error(`❌ [Auto-Manifest] Failed to process order ${batch[index].order_id}:`, errorMsg);
          }
        });

        // Small delay between batches to be respectful to the API
        if (i + batchSize < ordersNeedingManifest.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
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
      console.log(`🔄 [Auto-Manifest] Processing order: ${order.order_id}`);
      
      const database = require('../config/database');
      
      // Call Shipway Create Manifest API
      const manifestResponse = await this.callShipwayCreateManifestAPI([order.order_id]);
      
      if (!manifestResponse.success) {
        throw new Error(`Manifest API failed: ${manifestResponse.message}`);
      }
      
      // Update is_manifest = 1 in database
      await database.updateManifestStatus(order.order_id, true);
      
      console.log(`✅ [Auto-Manifest] Successfully created manifest for order ${order.order_id}`);
      
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
   * Call Shipway Create Manifest API
   * @param {Array} orderIds - Array of order IDs
   */
  async callShipwayCreateManifestAPI(orderIds) {
    try {
      console.log('🔄 [Auto-Manifest] Calling Shipway Create Manifest API');
      
      const basicAuthHeader = process.env.SHIPWAY_BASIC_AUTH_HEADER;
      if (!basicAuthHeader) {
        throw new Error('SHIPWAY_BASIC_AUTH_HEADER not found in environment variables');
      }

      const requestBody = {
        order_ids: orderIds
      };

      console.log('📤 [Auto-Manifest] Manifest API Request:', requestBody);

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

      console.log('✅ [Auto-Manifest] Shipway Create Manifest API call successful');
      
      return {
        success: true,
        data: data,
        message: 'Manifest created successfully'
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
