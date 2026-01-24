const axios = require('axios');
const database = require('../config/database');

/**
 * Order Tracking Service
 * Handles fetching and storing order tracking data from Shipway API
 * Supports dual cron logic: active orders (hourly) and inactive orders (daily)
 * Now supports multi-store via account_code from orders
 */
class OrderTrackingService {
  constructor() {
    this.isActiveSyncRunning = false;
    this.isInactiveSyncRunning = false;
    this.shipwayApiUrl = 'https://app.shipway.com/api/Ndr/OrderDetails';
    // Store credentials cache: account_code -> auth_token
    this.storeCredentialsCache = new Map();
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
        const batchPromises = batch.map(order => this.processOrderTracking(order.order_id, 'active', order.account_code));
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
        const batchPromises = batch.map(order => this.processOrderTracking(order.order_id, 'inactive', order.account_code));
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
   * @param {string} accountCode - The account_code for the store
   */
  async processOrderTracking(orderId, orderType, accountCode) {
    try {
      if (!accountCode) {
        throw new Error('account_code is required for processing order tracking');
      }

      console.log(`🔄 [Tracking] Fetching tracking data for order ${orderId} (${orderType}, store: ${accountCode})`);
      
      // Fetch tracking data from Shipway API
      const trackingData = await this.fetchTrackingFromShipway(orderId, accountCode);
      
      if (!trackingData || !trackingData.shipment_status_history) {
        console.log(`⚠️ [Tracking] No tracking data found for order ${orderId}`);
        return { success: true, message: 'No tracking data available' };
      }

      // Validate that shipment_status_history is a non-empty array
      if (!Array.isArray(trackingData.shipment_status_history) || trackingData.shipment_status_history.length === 0) {
        console.log(`⚠️ [Tracking] Empty or invalid shipment_status_history for order ${orderId}`);
        return { success: true, message: 'No tracking events available' };
      }

      // Validate that the last event has required properties
      const latestStatus = trackingData.shipment_status_history[trackingData.shipment_status_history.length - 1];
      if (!latestStatus || !latestStatus.name) {
        console.log(`⚠️ [Tracking] Invalid latest status for order ${orderId}:`, latestStatus);
        return { success: true, message: 'Invalid tracking status data' };
      }

      // Normalize all tracking events before storing (for order_tracking table)
      const normalizedTrackingEvents = trackingData.shipment_status_history.map(event => {
        if (event && event.name) {
          return {
            ...event,
            name: this.normalizeShipmentStatus(event.name)
          };
        }
        return event;
      });

      // Determine actual order type based on latest status (using normalized status)
      const actualOrderType = this.determineOrderType({ ...trackingData, shipment_status_history: normalizedTrackingEvents });
      
      // Store tracking data with normalized statuses
      const database = require('../config/database');
      await database.storeOrderTracking(orderId, actualOrderType, normalizedTrackingEvents);
      
      console.log(`✅ [Tracking] Stored ${normalizedTrackingEvents.length} tracking events for order ${orderId}`);
      
      // Normalize latest status for labels table
      const normalizedLatestStatus = this.normalizeShipmentStatus(latestStatus.name);
      
      // Update labels table with current shipment status and handover logic
      // Check if normalized status is "In Transit" (case-insensitive)
      const isHandover = normalizedLatestStatus === 'In Transit';
      
      // Get the timestamp for handover event (if available)
      // IMPORTANT: We want the FIRST "In Transit" event (normalized), not the latest
      let handoverTimestamp = null;
      if (isHandover) {
        // Find the first occurrence of "In Transit" status (events are already normalized)
        const firstInTransitEvent = normalizedTrackingEvents.find(event => {
          return event && event.name === 'In Transit';
        });
        if (firstInTransitEvent && firstInTransitEvent.time) {
          handoverTimestamp = firstInTransitEvent.time;
          console.log(`🚚 [Tracking] Found first "In Transit" event (normalized) for order ${orderId} at timestamp: ${handoverTimestamp}`);
        }
      }
      
      await database.updateLabelsShipmentStatus(orderId, accountCode, normalizedLatestStatus, isHandover, handoverTimestamp);
      
      return {
        success: true,
        message: 'Tracking data processed successfully',
        eventsCount: normalizedTrackingEvents.length,
        orderType: actualOrderType,
        currentStatus: normalizedLatestStatus,
        isHandover: isHandover
      };
      
    } catch (error) {
      console.error(`❌ [Tracking] Failed to process order ${orderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Normalize shipment status to handle case-insensitive matching and map pickup variations to "In Transit"
   * @param {string} status - The raw status from Shipway API
   * @returns {string} Normalized status (e.g., "In Transit" for all pickup variations)
   */
  normalizeShipmentStatus(status) {
    if (!status || typeof status !== 'string') {
      return status || 'Unknown';
    }

    // Convert to lowercase and replace underscores with spaces for consistent comparison
    // This handles: "picked_up", "PICKED_UP", "IN_TRANSIT", "in_transit", etc.
    const normalized = status.trim().toLowerCase().replace(/_/g, ' ');

    // First, handle failure statuses that should NOT be mapped to "In Transit"
    // These should be handled separately
    if (normalized.includes('pickup failed') || normalized.includes('failed pickup')) {
      return 'Pickup Failed';
    }

    // Map all pickup variations to "In Transit" (case-insensitive, handles underscores)
    // Matches: 
    // - "picked up", "PICKED UP", "Picked Up" 
    // - "picked_up", "PICKED_UP", "picked_UP"
    // - "shipment picked up", "shipment_picked_up"
    // - "pickup done", "pickup_done"
    // - "picked", "PICKED"
    // - "in transit", "IN TRANSIT", "In Transit"
    // - "in_transit", "IN_TRANSIT", "in_TRANSIT"
    // Note: "pickup failed" is excluded above
    if (
      normalized.includes('picked') ||
      normalized.includes('pickup') ||
      normalized === 'in transit'
    ) {
      return 'In Transit';
    }

    // Normalize "Delivered" variations (case-insensitive, handles underscores)
    if (normalized === 'delivered') {
      return 'Delivered';
    }

    // Return original status with proper casing for common statuses
    // For other statuses, return as-is (preserve original casing)
    const commonStatuses = {
      'out for delivery': 'Out for Delivery',
      'rto': 'RTO',
      'cancelled': 'Cancelled',
      'returned': 'Returned',
      'failed delivery': 'Failed Delivery',
      'attempted delivery': 'Attempted Delivery',
      'shipment booked': 'Shipment Booked',
      'dispatched': 'Dispatched',
      'in warehouse': 'In Warehouse',
      'out for pickup': 'Out for Pickup',
      'rto delivered': 'RTO Delivered'
    };

    if (commonStatuses[normalized]) {
      return commonStatuses[normalized];
    }

    // Return original status if no normalization needed
    return status;
  }

  /**
   * Get store credentials for a given account_code
   * @param {string} accountCode - The account_code to get credentials for
   * @returns {string} The auth_token for the store
   */
  async getStoreCredentials(accountCode) {
    if (!accountCode) {
      throw new Error('account_code is required for fetching tracking data');
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
   * Fetch tracking data from Shipway API
   * @param {string} orderId - The order ID to fetch tracking for
   * @param {string} accountCode - The account_code for the store
   */
  async fetchTrackingFromShipway(orderId, accountCode) {
    try {
      if (!accountCode) {
        throw new Error('account_code is required for fetching tracking data');
      }

      // Get store-specific credentials
      const basicAuthHeader = await this.getStoreCredentials(accountCode);

      console.log(`📡 [API] Calling Shipway OrderDetails API for order ${orderId} (store: ${accountCode})`);
      
      const response = await axios.post(this.shipwayApiUrl, {
        order_id: orderId
      }, {
        headers: {
          'Authorization': basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.status !== 200) {
        throw new Error(`Shipway API returned status ${response.status}`);
      }

      const data = response.data;

      // Handle array response (new API format)
      let trackingDetails = null;
      if (Array.isArray(data) && data.length > 0) {
        // Take first element from array
        const firstItem = data[0];
        if (firstItem.tracking_details) {
          trackingDetails = firstItem.tracking_details;
        }
      } else if (data && data.tracking_details) {
        // Direct object with tracking_details
        trackingDetails = data.tracking_details;
      } else if (data && data.success === "1" && data.shipment_status_history) {
        // Old API format - return as is
        console.log(`✅ [API] Received tracking data for order ${orderId}: ${data.shipment_status_history?.length || 0} events`);
        return data;
      }

      // Extract shipment_status from new API format
      if (trackingDetails && trackingDetails.shipment_status) {
        const currentStatus = trackingDetails.shipment_status;
        const currentDateTime = new Date().toISOString().slice(0, 19).replace('T', ' '); // Format: YYYY-MM-DD HH:MM:SS
        
        // Create our own history with single entry
        const shipmentStatusHistory = [
          {
            name: currentStatus,
            time: currentDateTime
          }
        ];

        console.log(`✅ [API] Received tracking data for order ${orderId}: Extracted status "${currentStatus}" at ${currentDateTime}`);
        
        // Return in the expected format
        return {
          success: "1",
          shipment_status_history: shipmentStatusHistory
        };
      }

      // If no tracking_details found, check for old format
      if (!data || data.success !== "1") {
        throw new Error(`API error: ${data?.message || 'Unknown error'}`);
      }

      // Fallback to old format if shipment_status_history exists
      if (data.shipment_status_history) {
        console.log(`✅ [API] Received tracking data for order ${orderId}: ${data.shipment_status_history?.length || 0} events`);
        return data;
      }

      throw new Error('Invalid API response format: No tracking_details or shipment_status_history found');
      
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
   * @param {Object} trackingData - Tracking data from Shipway API (should already be normalized)
   */
  determineOrderType(trackingData) {
    if (!trackingData.shipment_status_history || trackingData.shipment_status_history.length === 0) {
      return 'active'; // Default to active if no history
    }

    // Get the latest status (last item in the array)
    const latestStatus = trackingData.shipment_status_history[trackingData.shipment_status_history.length - 1];
    
    // Validate latestStatus has name property
    if (!latestStatus || !latestStatus.name) {
      console.log(`⚠️ [Tracking] Invalid latest status in determineOrderType:`, latestStatus);
      return 'active'; // Default to active if invalid
    }
    
    // Use normalized status for comparison (should already be normalized, but normalize again for safety)
    const normalizedStatus = this.normalizeShipmentStatus(latestStatus.name);
    
    if (normalizedStatus === 'Delivered') {
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
