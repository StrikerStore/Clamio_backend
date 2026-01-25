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
    this.shipwayApiUrl = 'https://app.shipway.com/api/tracking';
    // Store credentials cache: account_code -> auth_token
    this.storeCredentialsCache = new Map();
  }

  /**
   * Sync tracking data for ACTIVE orders (called every 1 hour)
   * Target: Orders with label_downloaded = 1
   * Note: Active/inactive determined by latest shipment_status from Shipway API
   * OPTIMIZED: Uses batch AWB fetching (50 AWBs per API call)
   */
  async syncActiveOrderTracking() {
    if (this.isActiveSyncRunning) {
      console.log('🔄 [Active Tracking] Sync already running, skipping...');
      return { success: false, message: 'Active tracking sync already in progress' };
    }

    this.isActiveSyncRunning = true;

    try {
      console.log('🚀 [Active Tracking] Starting sync for active orders (batch mode)...');

      const database = require('../config/database');
      await database.waitForMySQLInitialization();

      if (!database.isMySQLAvailable()) {
        throw new Error('Database connection not available');
      }

      // Get active orders (label_downloaded = 1)
      const activeOrders = await database.getActiveOrdersForTracking();
      console.log(`📦 [Active Tracking] Found ${activeOrders.length} active orders to sync`);

      if (activeOrders.length === 0) {
        return {
          success: true,
          message: 'No active orders to sync',
          processed: 0,
          successCount: 0,
          errorCount: 0,
          timestamp: new Date().toISOString()
        };
      }

      let successCount = 0;
      let errorCount = 0;

      // Group orders by account_code (each store has different auth_token)
      const ordersByStore = new Map();
      for (const order of activeOrders) {
        if (!order.awb) continue; // Skip orders without AWB

        if (!ordersByStore.has(order.account_code)) {
          ordersByStore.set(order.account_code, []);
        }
        ordersByStore.get(order.account_code).push(order);
      }

      console.log(`📊 [Active Tracking] Orders grouped into ${ordersByStore.size} store(s)`);

      // Process each store's orders with batch AWB fetching
      const awbBatchSize = 50; // Max AWBs per API call

      for (const [accountCode, storeOrders] of ordersByStore) {
        console.log(`🏪 [Active Tracking] Processing store ${accountCode}: ${storeOrders.length} orders`);

        // Split orders into batches of 50 AWBs
        for (let i = 0; i < storeOrders.length; i += awbBatchSize) {
          const batch = storeOrders.slice(i, i + awbBatchSize);
          const awbs = batch.map(order => order.awb);

          console.log(`📡 [Active Tracking] Fetching batch ${Math.floor(i / awbBatchSize) + 1}/${Math.ceil(storeOrders.length / awbBatchSize)} (${awbs.length} AWBs) for store ${accountCode}`);

          try {
            // Fetch tracking data for all AWBs in batch with single API call
            const trackingDataMap = await this.fetchBatchTrackingFromShipway(awbs, accountCode);

            // Process each order with its pre-fetched tracking data
            const processPromises = batch.map(async order => {
              const trackingData = trackingDataMap.get(String(order.awb));
              return this.processOrderTrackingWithData(order.order_id, 'active', order.account_code, order.awb, trackingData);
            });

            const results = await Promise.allSettled(processPromises);

            results.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                successCount++;
              } else {
                errorCount++;
                console.error(`❌ [Active Tracking] Failed to process order ${batch[index].order_id}:`, result.reason?.message);
              }
            });

          } catch (batchError) {
            console.error(`❌ [Active Tracking] Batch fetch failed for store ${accountCode}:`, batchError.message);
            errorCount += batch.length;
          }

          // Small delay between batches to be respectful to the API
          if (i + awbBatchSize < storeOrders.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // Delay between stores
        await new Promise(resolve => setTimeout(resolve, 500));
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
        message: 'Active tracking sync completed (batch mode)',
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
   * OPTIMIZED: Uses batch AWB fetching (50 AWBs per API call)
   */
  async syncInactiveOrderTracking() {
    if (this.isInactiveSyncRunning) {
      console.log('🔄 [Inactive Tracking] Sync already running, skipping...');
      return { success: false, message: 'Inactive tracking sync already in progress' };
    }

    this.isInactiveSyncRunning = true;

    try {
      console.log('🚀 [Inactive Tracking] Starting sync for inactive orders (batch mode)...');

      const database = require('../config/database');
      await database.waitForMySQLInitialization();

      if (!database.isMySQLAvailable()) {
        throw new Error('Database connection not available');
      }

      // Get inactive orders (label_downloaded = 1)
      const inactiveOrders = await database.getInactiveOrdersForTracking();
      console.log(`📦 [Inactive Tracking] Found ${inactiveOrders.length} inactive orders to sync`);

      if (inactiveOrders.length === 0) {
        return {
          success: true,
          message: 'No inactive orders to sync',
          processed: 0,
          successCount: 0,
          errorCount: 0,
          timestamp: new Date().toISOString()
        };
      }

      let successCount = 0;
      let errorCount = 0;

      // Group orders by account_code (each store has different auth_token)
      const ordersByStore = new Map();
      for (const order of inactiveOrders) {
        if (!order.awb) continue; // Skip orders without AWB

        if (!ordersByStore.has(order.account_code)) {
          ordersByStore.set(order.account_code, []);
        }
        ordersByStore.get(order.account_code).push(order);
      }

      console.log(`📊 [Inactive Tracking] Orders grouped into ${ordersByStore.size} store(s)`);

      // Process each store's orders with batch AWB fetching
      const awbBatchSize = 50; // Max AWBs per API call

      for (const [accountCode, storeOrders] of ordersByStore) {
        console.log(`🏪 [Inactive Tracking] Processing store ${accountCode}: ${storeOrders.length} orders`);

        // Split orders into batches of 50 AWBs
        for (let i = 0; i < storeOrders.length; i += awbBatchSize) {
          const batch = storeOrders.slice(i, i + awbBatchSize);
          const awbs = batch.map(order => order.awb);

          console.log(`📡 [Inactive Tracking] Fetching batch ${Math.floor(i / awbBatchSize) + 1}/${Math.ceil(storeOrders.length / awbBatchSize)} (${awbs.length} AWBs) for store ${accountCode}`);

          try {
            // Fetch tracking data for all AWBs in batch with single API call
            const trackingDataMap = await this.fetchBatchTrackingFromShipway(awbs, accountCode);

            // Process each order with its pre-fetched tracking data
            const processPromises = batch.map(async order => {
              const trackingData = trackingDataMap.get(String(order.awb));
              return this.processOrderTrackingWithData(order.order_id, 'inactive', order.account_code, order.awb, trackingData);
            });

            const results = await Promise.allSettled(processPromises);

            results.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                successCount++;
              } else {
                errorCount++;
                console.error(`❌ [Inactive Tracking] Failed to process order ${batch[index].order_id}:`, result.reason?.message);
              }
            });

          } catch (batchError) {
            console.error(`❌ [Inactive Tracking] Batch fetch failed for store ${accountCode}:`, batchError.message);
            errorCount += batch.length;
          }

          // Delay between batches
          if (i + awbBatchSize < storeOrders.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        // Delay between stores
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`✅ [Inactive Tracking] Sync completed: ${successCount} success, ${errorCount} errors`);

      return {
        success: true,
        message: 'Inactive tracking sync completed (batch mode)',
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
   * Fetch tracking data for multiple AWBs in a single API call (BATCH)
   * @param {Array<string>} awbs - Array of AWB numbers to fetch tracking for
   * @param {string} accountCode - The account_code for the store
   * @returns {Map<string, Object>} Map of AWB -> tracking data
   */
  async fetchBatchTrackingFromShipway(awbs, accountCode) {
    const trackingDataMap = new Map();

    try {
      if (!accountCode) {
        throw new Error('account_code is required for fetching tracking data');
      }

      if (!awbs || awbs.length === 0) {
        return trackingDataMap;
      }

      // Get store-specific credentials
      const basicAuthHeader = await this.getStoreCredentials(accountCode);

      // Build the API URL with comma-separated AWBs
      const awbString = awbs.join(',');
      const apiUrl = `${this.shipwayApiUrl}?awb_numbers=${awbString}&tracking_history=1`;

      console.log(`📡 [API] Calling Shipway Tracking API for ${awbs.length} AWBs (store: ${accountCode})`);

      const response = await axios.get(apiUrl, {
        headers: {
          'Authorization': basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 second timeout for batch requests
      });

      if (response.status !== 200) {
        throw new Error(`Shipway API returned status ${response.status}`);
      }

      const data = response.data;

      if (!Array.isArray(data) || data.length === 0) {
        console.log(`⚠️ [API] No tracking data returned for batch`);
        return trackingDataMap;
      }

      // Process each tracking result and add to map
      for (const trackingResult of data) {
        if (!trackingResult || !trackingResult.awb) continue;

        const awb = String(trackingResult.awb);
        const trackingDetails = trackingResult.tracking_details;

        if (!trackingDetails || !trackingDetails.shipment_status) {
          console.log(`⚠️ [API] No tracking_details for AWB ${awb}`);
          continue;
        }

        const currentStatus = trackingDetails.shipment_status;
        const currentDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const shipmentDetails = trackingDetails.shipment_details || [];
        const shipmentTrackActivities = trackingDetails.shipment_track_activities || [];

        // Create normalized tracking data structure
        const normalizedData = {
          success: "1",
          shipment_status_history: [
            {
              name: currentStatus,
              time: currentDateTime
            }
          ],
          shipment_details: shipmentDetails,
          shipment_track_activities: shipmentTrackActivities
        };

        trackingDataMap.set(awb, normalizedData);
      }

      console.log(`✅ [API] Batch fetch complete: ${trackingDataMap.size}/${awbs.length} AWBs have tracking data`);
      return trackingDataMap;

    } catch (error) {
      if (error.response) {
        console.error(`❌ [API] Shipway batch API error:`, error.response.status, error.response.data);
        throw new Error(`Shipway API error: ${error.response.data?.message || error.response.statusText}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout - Shipway API not responding');
      } else {
        throw new Error(`Network error: ${error.message}`);
      }
    }
  }

  /**
   * Process tracking data for a single order with pre-fetched data
   * Used by batch sync to avoid individual API calls
   * @param {string} orderId - The order ID
   * @param {string} orderType - 'active' or 'inactive'
   * @param {string} accountCode - The account_code for the store
   * @param {string} awb - The AWB number
   * @param {Object|null} trackingData - Pre-fetched tracking data (or null if not available)
   */
  async processOrderTrackingWithData(orderId, orderType, accountCode, awb, trackingData) {
    try {
      if (!accountCode) {
        throw new Error('account_code is required for processing order tracking');
      }

      if (!awb) {
        return { success: true, message: 'No AWB available for tracking' };
      }

      if (!trackingData || !trackingData.shipment_status_history) {
        return { success: true, message: 'No tracking data available' };
      }

      // Validate that shipment_status_history is a non-empty array
      if (!Array.isArray(trackingData.shipment_status_history) || trackingData.shipment_status_history.length === 0) {
        return { success: true, message: 'No tracking events available' };
      }

      // Validate that the last event has required properties
      const latestStatus = trackingData.shipment_status_history[trackingData.shipment_status_history.length - 1];
      if (!latestStatus || !latestStatus.name) {
        return { success: true, message: 'Invalid tracking status data' };
      }

      // Normalize all tracking events before storing (for order_tracking table)
      const normalizedTrackingEvents = await Promise.all(
        trackingData.shipment_status_history.map(async event => {
          if (event && event.name) {
            return {
              ...event,
              name: await this.normalizeShipmentStatus(event.name)
            };
          }
          return event;
        })
      );

      // Determine actual order type based on latest status
      const actualOrderType = this.determineOrderType({ ...trackingData, shipment_status_history: normalizedTrackingEvents });

      // Store tracking data with normalized statuses
      const database = require('../config/database');
      await database.storeOrderTracking(orderId, actualOrderType, normalizedTrackingEvents);

      // Normalize latest status for labels table
      const normalizedLatestStatus = await this.normalizeShipmentStatus(latestStatus.name);

      // Check if status should set is_handover = 1
      const isHandover = await this.shouldSetHandover(latestStatus.name);

      // Get the timestamp for handover event
      let handoverTimestamp = null;
      if (isHandover) {
        for (const event of normalizedTrackingEvents) {
          if (event && event.name) {
            const eventIsHandover = await this.shouldSetHandover(event.name);
            if (eventIsHandover && event.time) {
              handoverTimestamp = event.time;
              break;
            }
          }
        }
      }

      await database.updateLabelsShipmentStatus(orderId, accountCode, normalizedLatestStatus, isHandover, handoverTimestamp);

      // Check if status is RTO-related and store in RTO tracking table
      if (this.isRTOStatus(normalizedLatestStatus)) {
        try {
          let rtoWh = null;
          let activityDate = null;

          if (trackingData.shipment_track_activities && trackingData.shipment_track_activities.length > 0) {
            const validActivities = trackingData.shipment_track_activities.filter(activity =>
              activity.date && activity.date.trim() && activity.date !== '1970-01-01 05:30:00'
            );

            if (validActivities.length > 0) {
              const sortedActivities = validActivities.sort((a, b) => {
                const dateA = new Date(a.date);
                const dateB = new Date(b.date);
                return dateB - dateA;
              });

              rtoWh = sortedActivities[0].location || null;
              activityDate = sortedActivities[0].date || null;
            }
          }

          if (!rtoWh && trackingData.shipment_details?.[0]?.delivered_to) {
            rtoWh = trackingData.shipment_details[0].delivered_to;
          }

          await database.storeRTOTracking(orderId, normalizedLatestStatus, accountCode, rtoWh, activityDate);
        } catch (rtoError) {
          console.error(`⚠️ [RTO] Failed to store RTO tracking for order ${orderId}:`, rtoError.message);
        }
      }

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
   * Process tracking data for a single order
   * @param {string} orderId - The order ID to fetch tracking for
   * @param {string} orderType - 'active' or 'inactive'
   * @param {string} accountCode - The account_code for the store
   * @param {string} awb - The AWB number for the shipment
   */
  async processOrderTracking(orderId, orderType, accountCode, awb) {
    try {
      if (!accountCode) {
        throw new Error('account_code is required for processing order tracking');
      }

      if (!awb) {
        console.log(`⚠️ [Tracking] No AWB found for order ${orderId}, skipping tracking sync`);
        return { success: true, message: 'No AWB available for tracking' };
      }

      console.log(`🔄 [Tracking] Fetching tracking data for order ${orderId} (AWB: ${awb}, ${orderType}, store: ${accountCode})`);

      // Fetch tracking data from Shipway API using AWB
      const trackingData = await this.fetchTrackingFromShipway(awb, accountCode);

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
      // Use Promise.all since normalizeShipmentStatus is now async
      const normalizedTrackingEvents = await Promise.all(
        trackingData.shipment_status_history.map(async event => {
          if (event && event.name) {
            return {
              ...event,
              name: await this.normalizeShipmentStatus(event.name)
            };
          }
          return event;
        })
      );

      // Determine actual order type based on latest status (using normalized status)
      const actualOrderType = this.determineOrderType({ ...trackingData, shipment_status_history: normalizedTrackingEvents });

      // Store tracking data with normalized statuses
      const database = require('../config/database');
      await database.storeOrderTracking(orderId, actualOrderType, normalizedTrackingEvents);

      console.log(`✅ [Tracking] Stored ${normalizedTrackingEvents.length} tracking events for order ${orderId}`);

      // Normalize latest status for labels table (now async)
      const normalizedLatestStatus = await this.normalizeShipmentStatus(latestStatus.name);

      // Update labels table with current shipment status and handover logic
      // Check if status should set is_handover = 1 using database mapping
      const isHandover = await this.shouldSetHandover(latestStatus.name);

      // Get the timestamp for handover event (if available)
      // IMPORTANT: We want the FIRST handover-qualifying event, not the latest
      let handoverTimestamp = null;
      if (isHandover) {
        // Find the first occurrence of a handover-qualifying status (async search)
        for (const event of normalizedTrackingEvents) {
          if (event && event.name) {
            const eventIsHandover = await this.shouldSetHandover(event.name);
            if (eventIsHandover && event.time) {
              handoverTimestamp = event.time;
              console.log(`🚚 [Tracking] Found first handover-qualifying event for order ${orderId} at timestamp: ${handoverTimestamp} (status: ${event.name})`);
              break;
            }
          }
        }
      }

      await database.updateLabelsShipmentStatus(orderId, accountCode, normalizedLatestStatus, isHandover, handoverTimestamp);

      // Check if status is RTO-related and store in RTO tracking table
      if (this.isRTOStatus(normalizedLatestStatus)) {
        try {
          // Extract RTO warehouse and activity date from shipment_track_activities - get from the latest dated activity
          let rtoWh = null;
          let activityDate = null;

          if (trackingData.shipment_track_activities && trackingData.shipment_track_activities.length > 0) {
            // Filter out activities with invalid/empty dates
            const validActivities = trackingData.shipment_track_activities.filter(activity =>
              activity.date && activity.date.trim() && activity.date !== '1970-01-01 05:30:00'
            );

            if (validActivities.length > 0) {
              // Sort by date descending to get the latest activity
              const sortedActivities = validActivities.sort((a, b) => {
                const dateA = new Date(a.date);
                const dateB = new Date(b.date);
                return dateB - dateA; // Latest first
              });

              // Get location and date from the latest activity
              rtoWh = sortedActivities[0].location || null;
              activityDate = sortedActivities[0].date || null;
              console.log(`📍 [RTO] Latest activity for order ${orderId}: location="${rtoWh}", date="${activityDate}"`);
            }
          }

          // Fallback to delivered_to from shipment_details if no activity location found
          if (!rtoWh && trackingData.shipment_details?.[0]?.delivered_to) {
            rtoWh = trackingData.shipment_details[0].delivered_to;
            console.log(`📍 [RTO] Using delivered_to fallback for order ${orderId}: "${rtoWh}"`);
          }

          await database.storeRTOTracking(orderId, normalizedLatestStatus, accountCode, rtoWh, activityDate);
          console.log(`📦 [RTO] Stored RTO tracking for order ${orderId} (status: ${normalizedLatestStatus}, rto_wh: ${rtoWh || 'N/A'}, activity_date: ${activityDate || 'N/A'})`);
        } catch (rtoError) {
          // Log but don't fail the entire tracking process if RTO storage fails
          console.error(`⚠️ [RTO] Failed to store RTO tracking for order ${orderId}:`, rtoError.message);
        }
      }

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
   * Normalize shipment status using database mapping
   * Falls back to basic normalization if status not found in mapping
   * @param {string} status - The raw status from Shipway API
   * @returns {Promise<string>} Normalized status
   */
  async normalizeShipmentStatus(status) {
    if (!status || typeof status !== 'string') {
      return status || 'Unknown';
    }

    const database = require('../config/database');

    // Try to get from database mapping first
    const statusInfo = await database.getShipmentStatusInfo(status);
    if (statusInfo) {
      return statusInfo.renamed;
    }

    // Fallback: Handle common patterns for unmapped statuses
    const normalized = status.trim().toLowerCase().replace(/_/g, ' ');

    // Handle failure statuses
    if (normalized.includes('pickup failed') || normalized.includes('failed pickup')) {
      return 'Pickup Failed';
    }

    // Map pickup variations to "In Transit"
    if (
      normalized.includes('picked') ||
      (normalized.includes('pickup') && !normalized.includes('failed')) ||
      normalized === 'in transit'
    ) {
      return 'In Transit';
    }

    // Normalize "Delivered" variations
    if (normalized === 'delivered') {
      return 'Delivered';
    }

    // Fallback common statuses for unmapped ones
    const fallbackStatuses = {
      'out for delivery': 'Out for Delivery',
      'rto': 'RTO',
      'rto initiated': 'RTO Initiated',
      'rto in transit': 'RTO In Transit',
      'rto delivered': 'RTO Delivered',
      'rto out for delivery': 'RTO Out for Delivery',
      'rto failed': 'RTO Failed',
      'rtd': 'RTO Delivered',
      'cancelled': 'Cancelled',
      'returned': 'Returned',
      'failed delivery': 'Failed Delivery',
      'attempted delivery': 'Attempted Delivery',
      'shipment booked': 'Shipment Booked',
      'dispatched': 'Dispatched',
      'in warehouse': 'In Warehouse',
      'out for pickup': 'Out for Pickup'
    };

    if (fallbackStatuses[normalized]) {
      return fallbackStatuses[normalized];
    }

    // Return original status if no normalization needed
    return status;
  }

  /**
   * Determine if a status should set is_handover = 1 using database mapping
   * Falls back to pattern-based detection for unmapped statuses
   * @param {string} status - The status to check
   * @returns {Promise<boolean>} True if is_handover should be set to 1
   */
  async shouldSetHandover(status) {
    if (!status || typeof status !== 'string') {
      return false;
    }

    const database = require('../config/database');

    // Try to get from database mapping first
    const statusInfo = await database.getShipmentStatusInfo(status);
    if (statusInfo) {
      return statusInfo.is_handover === 1;
    }

    // Fallback: Pattern-based detection for unmapped statuses
    const normalizedStatus = status.trim().toLowerCase().replace(/_/g, ' ');

    // Statuses where is_handover = 0 (not yet picked up)
    const nonHandoverPatterns = [
      'awb assigned',
      'shipment booked',
      'pickup failed',
      'out for pickup',
      'shpfr3'
    ];

    // Check if it's a non-handover status
    for (const pattern of nonHandoverPatterns) {
      if (normalizedStatus.includes(pattern) || normalizedStatus === pattern) {
        return false;
      }
    }

    // Handover patterns (package is in transit)
    const handoverPatterns = [
      'in transit', 'picked', 'dispatched', 'warehouse',
      'out for delivery', 'delivered', 'rto', 'undelivered',
      'failed delivery', 'attempted', 'cancelled', 'returned'
    ];

    for (const pattern of handoverPatterns) {
      if (normalizedStatus.includes(pattern)) {
        return true;
      }
    }

    // Default to false for unknown statuses
    return false;
  }

  /**
   * Check if a status is RTO-related
   * @param {string} status - The status to check
   * @returns {boolean} True if the status is RTO-related
   */
  isRTOStatus(status) {
    if (!status || typeof status !== 'string') {
      return false;
    }
    const normalizedStatus = status.toLowerCase();
    return normalizedStatus.includes('rto');
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
   * Fetch tracking data from Shipway API using the new GET /api/tracking endpoint
   * @param {string} awb - The AWB number to fetch tracking for
   * @param {string} accountCode - The account_code for the store
   */
  async fetchTrackingFromShipway(awb, accountCode) {
    try {
      if (!accountCode) {
        throw new Error('account_code is required for fetching tracking data');
      }

      if (!awb) {
        throw new Error('AWB number is required for fetching tracking data');
      }

      // Get store-specific credentials
      const basicAuthHeader = await this.getStoreCredentials(accountCode);

      // Build the API URL with query parameters (tracking_history=1 to get shipment_track_activities)
      const apiUrl = `${this.shipwayApiUrl}?awb_numbers=${awb}&tracking_history=1`;

      console.log(`📡 [API] Calling Shipway Tracking API for AWB ${awb} (store: ${accountCode})`);

      const response = await axios.get(apiUrl, {
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

      // The new API returns an array of tracking results
      // Example response with tracking_history=1:
      // [
      //   {
      //     "awb": 22679038356322,
      //     "tracking_details": {
      //       "shipment_status": "RTD",
      //       "shipment_details": [...],
      //       "track_url": "...",
      //       "shipment_track_activities": [
      //         { "date": "2026-01-14 15:11:34", "activity": "RETURN Accepted", "location": "Location (State)" },
      //         ...
      //       ]
      //     }
      //   }
      // ]

      if (!Array.isArray(data) || data.length === 0) {
        console.log(`⚠️ [API] No tracking data returned for AWB ${awb}`);
        return null;
      }

      // Find the tracking result for our AWB
      const trackingResult = data.find(item => String(item.awb) === String(awb));

      if (!trackingResult || !trackingResult.tracking_details) {
        console.log(`⚠️ [API] No tracking_details found for AWB ${awb}`);
        return null;
      }

      const trackingDetails = trackingResult.tracking_details;

      if (!trackingDetails.shipment_status) {
        console.log(`⚠️ [API] No shipment_status found for AWB ${awb}`);
        return null;
      }

      const currentStatus = trackingDetails.shipment_status;
      const currentDateTime = new Date().toISOString().slice(0, 19).replace('T', ' '); // Format: YYYY-MM-DD HH:MM:SS

      // Extract shipment_details for additional info
      const shipmentDetails = trackingDetails.shipment_details || [];

      // Extract shipment_track_activities for RTO warehouse extraction (latest activity location)
      const shipmentTrackActivities = trackingDetails.shipment_track_activities || [];

      // Create shipment_status_history in the format expected by processOrderTracking
      const shipmentStatusHistory = [
        {
          name: currentStatus,
          time: currentDateTime
        }
      ];

      console.log(`✅ [API] Received tracking data for AWB ${awb}: status="${currentStatus}", activities=${shipmentTrackActivities.length}`);

      // Return in the expected format with shipment_track_activities for RTO warehouse extraction
      return {
        success: "1",
        shipment_status_history: shipmentStatusHistory,
        shipment_details: shipmentDetails,
        shipment_track_activities: shipmentTrackActivities // Include for RTO warehouse extraction from latest activity
      };

    } catch (error) {
      if (error.response) {
        console.error(`❌ [API] Shipway API error for AWB ${awb}:`, error.response.status, error.response.data);
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
