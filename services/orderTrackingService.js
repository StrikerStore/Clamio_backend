const axios = require('axios');

/**
 * Order Tracking Service
 * Handles fetching and storing order tracking data from Shipway API
 * Supports dual cron logic: active orders (hourly) and inactive orders (daily)
 */
class OrderTrackingService {
  constructor() {
    this.isActiveSyncRunning = false;
    this.isInactiveSyncRunning = false;
    this.shipwayApiUrl = 'https://app.shipway.com/api/Ndr/OrderDetails';
    this.basicAuthHeader = process.env.SHIPWAY_BASIC_AUTH_HEADER;
  }

  /**
   * Sync tracking data for ACTIVE orders (called every 1 hour)
   * Target: Orders with label_downloaded = 1
   * Note: Active/inactive determined by latest shipment_status from Shipway API
   */
  async syncActiveOrderTracking() {
    if (this.isActiveSyncRunning) {
      console.log('🔄 [Active Tracking] Sync already running, skipping...');
      return { success: false, message: 'Active tracking sync already in progress' };
    }

    this.isActiveSyncRunning = true;
    
    try {
      console.log('🚀 [Active Tracking] Starting sync for active orders...');
      
      const database = require('../config/database');
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        throw new Error('Database connection not available');
      }

      // Get active orders (label_downloaded = 1)
      const activeOrders = await database.getActiveOrdersForTracking();
      console.log(`📦 [Active Tracking] Found ${activeOrders.length} active orders to sync`);

      let successCount = 0;
      let errorCount = 0;

      // Process orders in batches to avoid overwhelming the API
      const batchSize = 5;
      for (let i = 0; i < activeOrders.length; i += batchSize) {
        const batch = activeOrders.slice(i, i + batchSize);
        
        // Process batch in parallel
        const batchPromises = batch.map(order => this.processOrderTracking(order.order_id, 'active'));
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            successCount++;
            console.log(`✅ [Active Tracking] Synced order ${batch[index].order_id}`);
          } else {
            errorCount++;
            console.error(`❌ [Active Tracking] Failed to sync order ${batch[index].order_id}:`, result.reason.message);
          }
        });

        // Small delay between batches to be respectful to the API
        if (i + batchSize < activeOrders.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`✅ [Active Tracking] Sync completed: ${successCount} success, ${errorCount} errors`);
      
      // Validate handover/tracking logic after sync (runs hourly along with current_shipment_status update)
      try {
        console.log('[Handover/Tracking Validation] Running validation check after tracking sync...');
        const validationResult = await database.validateHandoverTrackingLogic();
        console.log(`✅ [Handover/Tracking Validation] Validation completed: ${validationResult.handoverTab} in handover, ${validationResult.trackingTab} in tracking`);
      } catch (validationError) {
        console.error('[Handover/Tracking Validation] Validation check failed:', validationError.message);
        // Don't fail the entire sync if validation fails
      }
      
      return {
        success: true,
        message: 'Active tracking sync completed',
        processed: activeOrders.length,
        successCount,
        errorCount,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('💥 [Active Tracking] Sync failed:', error.message);
      return {
        success: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.isActiveSyncRunning = false;
    }
  }

  /**
   * Sync tracking data for INACTIVE orders (called daily at 2 AM)
   * Target: Orders with label_downloaded = 1
   * Note: Active/inactive determined by latest shipment_status from Shipway API
   */
  async syncInactiveOrderTracking() {
    if (this.isInactiveSyncRunning) {
      console.log('🔄 [Inactive Tracking] Sync already running, skipping...');
      return { success: false, message: 'Inactive tracking sync already in progress' };
    }

    this.isInactiveSyncRunning = true;
    
    try {
      console.log('🚀 [Inactive Tracking] Starting sync for inactive orders...');
      
      const database = require('../config/database');
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        throw new Error('Database connection not available');
      }

      // Get inactive orders (label_downloaded = 1)
      const inactiveOrders = await database.getInactiveOrdersForTracking();
      console.log(`📦 [Inactive Tracking] Found ${inactiveOrders.length} inactive orders to sync`);

      let successCount = 0;
      let errorCount = 0;

      // Process orders in smaller batches for inactive orders (less urgent)
      const batchSize = 3;
      for (let i = 0; i < inactiveOrders.length; i += batchSize) {
        const batch = inactiveOrders.slice(i, i + batchSize);
        
        // Process batch in parallel
        const batchPromises = batch.map(order => this.processOrderTracking(order.order_id, 'inactive'));
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            successCount++;
            console.log(`✅ [Inactive Tracking] Synced order ${batch[index].order_id}`);
          } else {
            errorCount++;
            console.error(`❌ [Inactive Tracking] Failed to sync order ${batch[index].order_id}:`, result.reason.message);
          }
        });

        // Longer delay between batches for inactive orders
        if (i + batchSize < inactiveOrders.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      console.log(`✅ [Inactive Tracking] Sync completed: ${successCount} success, ${errorCount} errors`);
      
      return {
        success: true,
        message: 'Inactive tracking sync completed',
        processed: inactiveOrders.length,
        successCount,
        errorCount,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('💥 [Inactive Tracking] Sync failed:', error.message);
      return {
        success: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.isInactiveSyncRunning = false;
    }
  }

  /**
   * Process tracking data for a single order
   * @param {string} orderId - The order ID to fetch tracking for
   * @param {string} orderType - 'active' or 'inactive'
   */
  async processOrderTracking(orderId, orderType) {
    try {
      console.log(`🔄 [Tracking] Fetching tracking data for order ${orderId} (${orderType})`);
      
      // Fetch tracking data from Shipway API
      const trackingData = await this.fetchTrackingFromShipway(orderId);
      
      if (!trackingData || !trackingData.shipment_status_history) {
        console.log(`⚠️ [Tracking] No tracking data found for order ${orderId}`);
        return { success: true, message: 'No tracking data available' };
      }

      // Determine actual order type based on latest status
      const actualOrderType = this.determineOrderType(trackingData);
      
      // Store tracking data
      const database = require('../config/database');
      await database.storeOrderTracking(orderId, actualOrderType, trackingData.shipment_status_history);
      
      console.log(`✅ [Tracking] Stored ${trackingData.shipment_status_history.length} tracking events for order ${orderId}`);
      
      // Update labels table with current shipment status and handover logic
      const latestStatus = trackingData.shipment_status_history[trackingData.shipment_status_history.length - 1];
      const isHandover = latestStatus.name === 'In Transit';
      
      // Get the timestamp for handover event (if available)
      // IMPORTANT: We want the FIRST "In Transit" event, not the latest
      let handoverTimestamp = null;
      if (isHandover) {
        // Find the first occurrence of "In Transit" status
        const firstInTransitEvent = trackingData.shipment_status_history.find(event => event.name === 'In Transit');
        if (firstInTransitEvent && firstInTransitEvent.time) {
          handoverTimestamp = firstInTransitEvent.time;
          console.log(`🚚 [Tracking] Found first "In Transit" event for order ${orderId} at timestamp: ${handoverTimestamp}`);
        }
      }
      
      await database.updateLabelsShipmentStatus(orderId, latestStatus.name, isHandover, handoverTimestamp);
      
      return {
        success: true,
        message: 'Tracking data processed successfully',
        eventsCount: trackingData.shipment_status_history.length,
        orderType: actualOrderType,
        currentStatus: latestStatus.name,
        isHandover: isHandover
      };
      
    } catch (error) {
      console.error(`❌ [Tracking] Failed to process order ${orderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Fetch tracking data from Shipway API
   * @param {string} orderId - The order ID to fetch tracking for
   */
  async fetchTrackingFromShipway(orderId) {
    try {
      if (!this.basicAuthHeader) {
        throw new Error('Shipway API configuration error. SHIPWAY_BASIC_AUTH_HEADER not found.');
      }

      console.log(`📡 [API] Calling Shipway OrderDetails API for order ${orderId}`);
      
      const response = await axios.post(this.shipwayApiUrl, {
        order_id: orderId
      }, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.status !== 200) {
        throw new Error(`Shipway API returned status ${response.status}`);
      }

      const data = response.data;

      // Validate response structure
      if (!data || data.success !== "1") {
        throw new Error(`API error: ${data.message || 'Unknown error'}`);
      }

      console.log(`✅ [API] Received tracking data for order ${orderId}: ${data.shipment_status_history?.length || 0} events`);
      
      return data;
      
    } catch (error) {
      if (error.response) {
        console.error(`❌ [API] Shipway API error for order ${orderId}:`, error.response.status, error.response.data);
        throw new Error(`Shipway API error: ${error.response.data?.message || error.response.statusText}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout - Shipway API not responding');
      } else {
        throw new Error(`Network error: ${error.message}`);
      }
    }
  }

  /**
   * Determine order type based on latest tracking status
   * @param {Object} trackingData - Tracking data from Shipway API
   */
  determineOrderType(trackingData) {
    if (!trackingData.shipment_status_history || trackingData.shipment_status_history.length === 0) {
      return 'active'; // Default to active if no history
    }

    // Get the latest status (last item in the array)
    const latestStatus = trackingData.shipment_status_history[trackingData.shipment_status_history.length - 1];
    
    if (latestStatus.name === 'Delivered') {
      return 'inactive';
    } else {
      return 'active';
    }
  }

  /**
   * Get sync status for both active and inactive tracking
   */
  getSyncStatus() {
    return {
      activeSync: {
        isRunning: this.isActiveSyncRunning,
        timestamp: new Date().toISOString()
      },
      inactiveSync: {
        isRunning: this.isInactiveSyncRunning,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Cleanup old tracking data (optional maintenance function)
   */
  async cleanupOldTrackingData() {
    try {
      console.log('🧹 [Cleanup] Starting cleanup of old tracking data...');
      
      const database = require('../config/database');
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        throw new Error('Database connection not available');
      }

      // Remove tracking data older than 90 days
      const result = await database.cleanupOldOrderTracking();
      
      console.log(`✅ [Cleanup] Cleaned up ${result.deletedCount} old tracking records`);
      
      return {
        success: true,
        message: 'Cleanup completed',
        deletedCount: result.deletedCount,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('💥 [Cleanup] Failed:', error.message);
      return {
        success: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new OrderTrackingService();
