const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const database = require('../config/database');

/**
 * Generate stable unique_id from Shiprocket order.id and product.id
 * Uses accountCode + order.id + product.id to create a unique hash per product row.
 * @param {string|number} shiprocketOrderId - Shiprocket order-level id (stored in partner_order_id)
 * @param {string|number} shiprocketProductId - Shiprocket product-level id
 * @param {string} accountCode - Store account code
 * @returns {string} Stable unique_id (12-char uppercase MD5 hash)
 */
function generateStableUniqueId(shiprocketOrderId, shiprocketProductId, accountCode = '') {
  const storePart = accountCode || 'GLOBAL';
  const id = `${storePart}_${shiprocketOrderId}_${shiprocketProductId}`;
  return crypto.createHash('md5').update(id).digest('hex').substring(0, 12).toUpperCase();
}

/**
 * Parse Shiprocket date format ("21 Feb 2026, 09:30 PM") to MySQL DATETIME format
 * @param {string} dateStr - Shiprocket date string
 * @returns {string|null} MySQL-compatible datetime string or null
 */
function parseShiprocketDate(dateStr) {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    // Format as MySQL DATETIME: YYYY-MM-DD HH:MM:SS
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (e) {
    return null;
  }
}

/**
 * Shiprocket API Service
 * Handles all interactions with Shiprocket API for order import
 * Supports multi-store via account_code parameter
 */
class ShiprocketService {
  constructor(accountCode = null) {
    this.baseURL = 'https://apiv2.shiprocket.in/v1/external';
    this.accountCode = accountCode;
    this.authToken = null; // Bearer token
    this.initialized = false;
  }

  /**
   * Cancel one or more shipments in Shiprocket by AWB numbers.
   * Uses Shiprocket's bulk cancel API:
   *   POST /orders/cancel/shipment/awbs
   *   Body: { awbs: ["19041211125783"] }
   *
   * @param {string[]} awbs - Array of AWB numbers to cancel
   * @returns {Promise<{ success: boolean, data: any }>}
   */
  async cancelShipmentsByAwbs(awbs) {
    await this.initialize();

    try {
      if (!awbs || !Array.isArray(awbs) || awbs.length === 0) {
        throw new Error('AWB numbers array is required and cannot be empty');
      }

      if (!this.authToken) {
        throw new Error('Shiprocket API configuration error. Please contact administrator.');
      }

      const url = `${this.baseURL}/orders/cancel/shipment/awbs`;
      const requestBody = { awbs };

      this.logApiActivity({
        type: 'shiprocket-cancel-request',
        url,
        awbs,
        headers: { Authorization: '***' },
      });

      const response = await axios.post(url, requestBody, {
        headers: {
          Authorization: this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      this.logApiActivity({
        type: 'shiprocket-cancel-response',
        status: response.status,
        data: response.data,
      });

      if (response.status !== 200) {
        throw new Error(`Shiprocket API returned status ${response.status}`);
      }

      // Check if response contains an error message
      const responseData = response.data || {};
      if (responseData.message && responseData.message.toLowerCase().includes('error')) {
        throw new Error(`Shiprocket API error: ${responseData.message}`);
      }

      // Validate AWB numbers are not empty/null (convert to string first)
      const invalidAwbs = awbs.filter(awb => !awb || String(awb).trim() === '');
      if (invalidAwbs.length > 0) {
        throw new Error(`Invalid AWB numbers provided: ${invalidAwbs.join(', ')}`);
      }

      return {
        success: true,
        data: responseData,
        awbs,
      };
    } catch (error) {
      this.logApiActivity({
        type: 'shiprocket-cancel-error',
        awbs,
        error: error.message,
        stack: error.stack,
      });
      console.error('Error cancelling Shiprocket shipments for AWBs:', awbs, 'from Shiprocket API:', error.message);

      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Shiprocket API. Please check your internet connection.');
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Request to Shiprocket API timed out. Please try again.');
      }
      if (error.response) {
        const status = error.response.status;
        const msg = error.response.data?.message || `Status ${status}`;
        if (status === 401) {
          // Keep message generic – don't expose shipping partner name in UI
          throw new Error('Invalid shipping API credentials. Please check your configuration.');
        } else if (status === 404) {
          throw new Error('AWB numbers not found in Shiprocket system.');
        } else if (status === 429) {
          throw new Error('Shiprocket rate limit exceeded. Please try again later.');
        } else {
          throw new Error(`Shiprocket API error: ${msg}`);
        }
      }

      // If it's already a formatted Shiprocket error, rethrow
      if (error.message.includes('Shiprocket API') ||
          error.message.includes('Unable to connect') ||
          error.message.includes('timed out')) {
        throw error;
      }

      throw new Error('Failed to cancel shipment from Shiprocket API');
    }
  }

  /**
   * Initialize service by fetching store credentials
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      if (this.accountCode) {
        // Multi-store mode: fetch credentials from database
        const store = await database.getStoreByAccountCode(this.accountCode);

        if (!store) {
          throw new Error(`Store not found for account code: ${this.accountCode}`);
        }

        if (store.status !== 'active') {
          throw new Error(`Store is not active: ${this.accountCode}`);
        }

        if (store.shipping_partner !== 'Shiprocket') {
          throw new Error(`Store ${this.accountCode} is not a Shiprocket store`);
        }

        this.authToken = store.auth_token; // Should already be "Bearer <token>"
        console.log(`✅ ShiprocketService initialized for store: ${this.accountCode}`);
      } else {
        throw new Error('Account code is required for ShiprocketService');
      }

      if (!this.authToken) {
        throw new Error('Shiprocket API configuration error. No auth token available.');
      }

      this.initialized = true;
    } catch (error) {
      console.error('❌ ShiprocketService initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Sync orders from Shiprocket API to MySQL database
   * Preserves existing claim data (status, claimed_by, etc.) when syncing new orders.
   * Only adds new orders and updates existing orders when there are actual data changes.
   * Prevents unnecessary overriding of existing order data.
   */
  async syncOrdersToMySQL() {
    // Initialize service if not already initialized
    await this.initialize();

    const rawDataJsonPath = path.join(__dirname, `../data/raw_shiprocket_orders_${this.accountCode}.json`);
    const url = `${this.baseURL}/orders`;
    let shiprocketOrders = [];
    let rawApiResponse = null;

    try {
      // Fetch all orders using Shiprocket's page-based pagination
      let allOrders = [];
      let page = 1;
      let hasMorePages = true;

      console.log(`🔄 Starting paginated fetch from Shiprocket API (${this.accountCode})...`);

      while (hasMorePages) {
        this.logApiActivity({
          type: 'shiprocket-request',
          url,
          page: page,
          headers: { Authorization: '***' }
        });

        console.log(`📄 Fetching page ${page}...`);

        const response = await axios.get(url, {
          params: { page: page },
          headers: {
            'Authorization': this.authToken,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        });

        if (response.status !== 200 || !response.data) {
          throw new Error('Invalid response from Shiprocket API');
        }

        let currentPageOrders = [];

        if (response.data.data && Array.isArray(response.data.data)) {
          currentPageOrders = response.data.data;
        } else {
          this.logApiActivity({ type: 'shiprocket-unexpected-format', data: response.data });
          throw new Error('Unexpected Shiprocket API response format');
        }

        console.log(`  ✅ Page ${page}: ${currentPageOrders.length} orders`);

        // Add orders from this page to our collection
        allOrders = allOrders.concat(currentPageOrders);

        // Check pagination meta
        const meta = response.data.meta;
        if (meta && meta.pagination) {
          const { current_page, total_pages } = meta.pagination;
          if (current_page >= total_pages) {
            hasMorePages = false;
            console.log(`  🏁 Last page reached (page ${current_page}/${total_pages})`);
          } else {
            console.log(`  ➡️ More pages available (page ${current_page}/${total_pages})`);
          }
        } else {
          // No pagination meta, stop
          hasMorePages = false;
          console.log(`  🏁 No pagination meta, stopping`);
        }

        this.logApiActivity({
          type: 'shiprocket-page-fetched',
          page: page,
          ordersInPage: currentPageOrders.length,
          totalOrdersSoFar: allOrders.length
        });

        page++;

        // Safety check to prevent infinite loops
        if (page > 100) {
          console.log('⚠️ Safety limit reached (100 pages), stopping pagination');
          this.logApiActivity({ type: 'shiprocket-pagination-limit-reached', totalOrders: allOrders.length });
          break;
        }
      }

      console.log(`🎉 Pagination complete! Total orders fetched: ${allOrders.length}`);

      // Filter orders to only include last N days (configurable from utility table)
      let numberOfDays = 60; // default
      try {
        const daysValue = await database.getUtilityParameter('number_of_day_of_order_include');
        if (daysValue) {
          numberOfDays = parseInt(daysValue) || 60;
        }
      } catch (e) {
        console.log('⚠️ Could not fetch number_of_day_of_order_include, using default 60 days');
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - numberOfDays);
      console.log(`📅 Applying date filter: last ${numberOfDays} days (cutoff: ${cutoffDate.toISOString()})`);

      // 1) Filter by date range
      const filteredOrdersByDate = allOrders.filter(order => {
        if (!order.channel_created_at) return false;

        const orderDate = new Date(order.channel_created_at);
        const isWithinDateRange = orderDate >= cutoffDate;

        if (!isWithinDateRange) {
          console.log(`  ⏰ Filtering out old order: ${order.channel_order_id} (${order.channel_created_at})`);
        }

        return isWithinDateRange;
      });

      console.log(`📅 Date filter applied: ${filteredOrdersByDate.length} orders within last ${numberOfDays} days (filtered out ${allOrders.length - filteredOrdersByDate.length} old orders)`);

      // 2) Exclude cancelled orders (status === "CANCELED")
      const filteredOrders = filteredOrdersByDate.filter(order => {
        const isCancelled = String(order.status || '').toUpperCase() === 'CANCELED';
        if (isCancelled) {
          console.log(`  🚫 Skipping cancelled order: ${order.channel_order_id} (status: ${order.status})`);
        }
        return !isCancelled;
      });

      console.log(`✅ Cancellation filter applied: ${filteredOrders.length} active orders (filtered out ${filteredOrdersByDate.length - filteredOrders.length} cancelled orders)`);

      shiprocketOrders = filteredOrders;
      rawApiResponse = { data: allOrders }; // Keep all orders in raw JSON

      // Store raw API response in JSON file (all orders)
      try {
        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(rawDataJsonPath, JSON.stringify(rawApiResponse, null, 2));
        console.log(`💾 Raw Shiprocket API data saved to: ${rawDataJsonPath}`);
      } catch (fileError) {
        console.warn(`⚠️ Could not save raw Shiprocket data: ${fileError.message}`);
      }

    } catch (error) {
      this.logApiActivity({ type: 'shiprocket-error', error: error.message, stack: error.stack });

      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error('Failed to fetch orders from Shiprocket API: Request timeout - The API took longer than 60 seconds to respond.');
      }

      throw new Error('Failed to fetch orders from Shiprocket API: ' + error.message);
    }

    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }

    // Get existing orders from MySQL to preserve claim data
    // IMPORTANT: Filter by account_code to prevent cross-store data interaction
    let existingOrders = [];
    let existingClaimData = new Map(); // Map to store claim data by account_code|order_id|product_code

    try {
      const allOrders = await database.getAllOrders();
      // Filter orders to only include current store's orders
      existingOrders = allOrders.filter(row => row.account_code === this.accountCode);

      // Build map of existing claim data with account_code in key
      existingOrders.forEach(row => {
        const key = `${row.account_code}|${row.order_id}|${row.product_code}`;
        existingClaimData.set(key, {
          unique_id: row.unique_id,
          status: row.status || 'unclaimed',
          claimed_by: row.claimed_by || '',
          claimed_at: row.claimed_at || '',
          last_claimed_by: row.last_claimed_by || '',
          last_claimed_at: row.last_claimed_at || '',
          clone_status: row.clone_status || 'not_cloned',
          cloned_order_id: row.cloned_order_id || '',
          is_cloned_row: row.is_cloned_row || false,
          label_downloaded: row.label_downloaded || false,
          handover_at: row.handover_at || '',
          customer_name: row.customer_name || '',
          priority_carrier: row.priority_carrier || '',
          pincode: row.pincode || ''
        });
      });
    } catch (e) {
      this.logApiActivity({ type: 'mysql-read-error', error: e.message });
    }

    // Flatten Shiprocket orders to one row per product, preserving existing claim data
    const flatOrders = [];

    for (const order of shiprocketOrders) {
      if (!Array.isArray(order.products) || order.products.length === 0) continue;

      // Extract order-level information
      const orderTotal = parseFloat(order.total) || 0;
      const shiprocketOrderId = order.id; // Shiprocket order-level id (stored in partner_order_id column)
      const channelId = order.channel_id; // Shiprocket channel_id
      
      // Extract shipment.id from order.shipments array (first shipment)
      // shipment.id should be stored in shipment_id column (not order.id)
      let shipmentId = null;
      if (order.shipments && Array.isArray(order.shipments) && order.shipments.length > 0) {
        shipmentId = order.shipments[0].id ? String(order.shipments[0].id) : null;
      }

      // Determine payment_type: "cod" → "C", "prepaid" → "P"
      const paymentMethod = (order.payment_method || '').toLowerCase();
      const paymentType = paymentMethod === 'cod' ? 'C' : 'P';

      // Determine is_partial_paid from payment_status
      const isPartialPaid = order.payment_status === 'partially_paid' ? 1 : 0;

      // Get partial values from others object for PPCOD calculations
      const partialCodCollected = parseFloat(order.others?.partial_cod_collected) || 0;
      const partialCodValue = parseFloat(order.others?.partial_cod_value) || 0;

      // Calculate total value (price × quantity) for all products in this order for ratio calculation
      const totalValueInOrder = order.products.reduce((sum, prod) => {
        const price = parseFloat(prod.price) || 0;
        const qty = parseInt(prod.quantity) || 1;
        return sum + (price * qty);
      }, 0);

      // Calculate ratio parts for each product based on (price × quantity)
      let productRatios = [];
      if (totalValueInOrder > 0) {
        const values = order.products.map(prod => {
          const price = parseFloat(prod.price) || 0;
          const qty = parseInt(prod.quantity) || 1;
          return price * qty;
        });

        // Convert values to integers to handle decimals (multiply by 100 for 2 decimal places)
        const intValues = values.map(val => Math.round(val * 100));

        // Find GCD of all values to get simplest integer ratio
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const findGCD = (arr) => arr.reduce((acc, val) => gcd(acc, val));

        const valuesGCD = findGCD(intValues.filter(v => v > 0));

        if (valuesGCD > 0) {
          productRatios = intValues.map(val => Math.round(val / valuesGCD));
        } else {
          productRatios = values.map(() => 1);
        }
      } else {
        productRatios = order.products.map(() => 1); // Equal ratio if no values
      }

      // Calculate total of all ratios for this order
      const totalRatios = productRatios.reduce((sum, ratio) => sum + ratio, 0);

      for (let i = 0; i < order.products.length; i++) {
        const product = order.products[i];
        const key = `${this.accountCode}|${order.channel_order_id}|${product.channel_sku}`;
        const existingClaim = existingClaimData.get(key);

        // Get selling price from product data
        const sellingPrice = parseFloat(product.price) || 0;

        // Get the ratio for this product
        const orderTotalRatio = productRatios[i] || 1;

        // Calculate the actual split amount for this product
        const orderTotalSplit = totalRatios > 0
          ? parseFloat(((orderTotalRatio / totalRatios) * orderTotal).toFixed(2))
          : parseFloat((orderTotal / order.products.length).toFixed(2));

        // Calculate prepaid_amount based on payment type and is_partial_paid
        let prepaidAmount = 0;
        if (paymentType === 'P') {
          // Fully prepaid: 100% of order_total_split
          prepaidAmount = parseFloat(orderTotalSplit.toFixed(2));
        } else if (paymentType === 'C' && isPartialPaid === 1) {
          // COD with partial prepaid: split partial_cod_collected by ratio
          prepaidAmount = totalRatios > 0
            ? parseFloat(((orderTotalRatio / totalRatios) * partialCodCollected).toFixed(2))
            : parseFloat((partialCodCollected / order.products.length).toFixed(2));
        } else {
          // Pure COD: 0% prepaid
          prepaidAmount = 0;
        }

        // Calculate collectable_amount based on payment type and is_partial_paid
        let collectableAmount = 0;
        if (paymentType === 'P') {
          // Fully prepaid: nothing to collect
          collectableAmount = 0;
        } else if (paymentType === 'C' && isPartialPaid === 1) {
          // COD with partial prepaid: split partial_cod_value by ratio
          collectableAmount = totalRatios > 0
            ? parseFloat(((orderTotalRatio / totalRatios) * partialCodValue).toFixed(2))
            : parseFloat((partialCodValue / order.products.length).toFixed(2));
        } else if (paymentType === 'C' && isPartialPaid === 0) {
          // Pure COD: collect 100% of order_total_split
          collectableAmount = parseFloat(orderTotalSplit.toFixed(2));
        }

        // Generate stable unique_id using order.id + product.id
        const stableUniqueId = generateStableUniqueId(shiprocketOrderId, product.id, this.accountCode);

        const orderRow = {
          id: stableUniqueId,
          unique_id: stableUniqueId,
          shipment_id: shipmentId, // Store shipment.id from order.shipments[0].id
          channel_id: String(channelId),
          partner_order_id: String(shiprocketOrderId), // Store order.id in partner_order_id
          order_id: order.channel_order_id,
          order_date: parseShiprocketDate(order.channel_created_at),
          product_name: product.name,
          product_code: product.channel_sku,
          quantity: parseInt(product.quantity) || 1,
          // Financial columns
          selling_price: sellingPrice,
          order_total: orderTotal,
          payment_type: paymentType,
          is_partial_paid: isPartialPaid,
          prepaid_amount: prepaidAmount,
          order_total_ratio: orderTotalRatio,
          order_total_split: orderTotalSplit,
          collectable_amount: collectableAmount,
          // Other fields
          pincode: order.customer_pincode || '',
          account_code: this.accountCode,
          // Customer name is directly available in Shiprocket
          customer_name: order.customer_name || '',
          // Preserve existing claim data or use defaults for new orders
          status: existingClaim ? existingClaim.status : 'unclaimed',
          claimed_by: existingClaim ? existingClaim.claimed_by : '',
          claimed_at: existingClaim ? existingClaim.claimed_at : '',
          last_claimed_by: existingClaim ? existingClaim.last_claimed_by : '',
          last_claimed_at: existingClaim ? existingClaim.last_claimed_at : '',
          clone_status: existingClaim ? existingClaim.clone_status : 'not_cloned',
          cloned_order_id: existingClaim ? existingClaim.cloned_order_id : '',
          is_cloned_row: existingClaim ? existingClaim.is_cloned_row : false,
          label_downloaded: existingClaim ? existingClaim.label_downloaded : false,
          handover_at: existingClaim ? existingClaim.handover_at : '',
          priority_carrier: existingClaim ? existingClaim.priority_carrier : ''
        };

        flatOrders.push(orderRow);
      }
    }

    // Compare and update MySQL only if changed
    // IMPORTANT: Include account_code in key to prevent cross-store data interaction
    const existingKeySet = new Set(existingOrders.map(r => `${r.account_code}|${r.order_id}|${r.product_code}`));
    const newKeySet = new Set(flatOrders.map(r => `${r.account_code}|${r.order_id}|${r.product_code}`));
    let changed = false;
    let newOrdersCount = 0;
    let updatedOrdersCount = 0;

    // Check for new rows
    for (const row of flatOrders) {
      if (!existingKeySet.has(`${row.account_code}|${row.order_id}|${row.product_code}`)) {
        changed = true;
        newOrdersCount++;
      }
    }

    console.log(`📊 Sync Summary: ${newOrdersCount} new orders, ${existingOrders.length} existing orders`);

    // ALWAYS update is_in_new_order flags (regardless of other changes)
    try {
      // Step 1: Mark all existing orders for THIS STORE as NOT in new order (is_in_new_order = 0)
      for (const existingOrder of existingOrders) {
        await database.updateOrder(existingOrder.unique_id, {
          is_in_new_order: false
        });
      }

      // Step 2: Insert or update orders from current Shiprocket API (is_in_new_order = 1)
      for (const orderRow of flatOrders) {
        const key = `${orderRow.account_code}|${orderRow.order_id}|${orderRow.product_code}`;
        // Set is_in_new_order = 1 for all orders from current Shiprocket API response
        orderRow.is_in_new_order = true;

        if (existingKeySet.has(key)) {
          // Check if existing order needs update
          const existingOrder = existingOrders.find(o => `${o.account_code}|${o.order_id}|${o.product_code}` === key);
          if (existingOrder) {
            // Shiprocket: Always update ALL fields from API (no freezing logic)
            // This ensures Shiprocket API is the source of truth for all data
            await database.updateOrder(existingOrder.unique_id, {
              order_date: orderRow.order_date,
              product_name: orderRow.product_name,
              customer_name: orderRow.customer_name,
              pincode: orderRow.pincode,
              // Financial fields - ALWAYS update from Shiprocket API
              selling_price: orderRow.selling_price,
              order_total: orderRow.order_total,
              payment_type: orderRow.payment_type,
              is_partial_paid: orderRow.is_partial_paid,
              prepaid_amount: orderRow.prepaid_amount,
              order_total_ratio: orderRow.order_total_ratio,
              order_total_split: orderRow.order_total_split,
              collectable_amount: orderRow.collectable_amount,
              // Other fields
              shipment_id: orderRow.shipment_id,
              channel_id: orderRow.channel_id,
              partner_order_id: orderRow.partner_order_id,
              is_in_new_order: true
            });
            updatedOrdersCount++;
            changed = true;
            console.log(`✅ Updated all fields from Shiprocket API: ${orderRow.order_id}|${orderRow.product_code}`);
          }
        } else {
          // Insert new order with error handling for potential unique_id collision
          try {
            await database.createOrder(orderRow);
            newOrdersCount++;
            changed = true;
            console.log(`➕ Added new order: ${orderRow.order_id}|${orderRow.product_code}`);
          } catch (insertError) {
            if (insertError.message && insertError.message.includes('ER_DUP_ENTRY')) {
              console.error(`❌ COLLISION DETECTED: Duplicate unique_id for ${orderRow.order_id}|${orderRow.product_code}`);
              console.error(`   unique_id: ${orderRow.unique_id}`);
              this.logApiActivity({
                type: 'unique-id-collision',
                orderId: orderRow.order_id,
                productCode: orderRow.product_code,
                uniqueId: orderRow.unique_id,
                error: insertError.message
              });
            } else {
              console.error(`❌ Error inserting order ${orderRow.order_id}|${orderRow.product_code}:`, insertError.message);
              this.logApiActivity({
                type: 'order-insert-error',
                orderId: orderRow.order_id,
                productCode: orderRow.product_code,
                uniqueId: orderRow.unique_id,
                error: insertError.message
              });
            }
            // Continue processing other orders
          }
        }
      }

      // Log the sync results
      this.logApiActivity({
        type: 'mysql-sync-completed',
        totalOrders: flatOrders.length,
        newOrders: newOrdersCount,
        updatedOrders: updatedOrdersCount,
        preservedOrders: flatOrders.length - newOrdersCount - updatedOrdersCount,
        preservedClaims: existingClaimData.size,
        flagsUpdated: true
      });

      console.log(`📊 Sync Results: ${newOrdersCount} new, ${updatedOrdersCount} updated, ${flatOrders.length - newOrdersCount - updatedOrdersCount} preserved`);

      // Only run enhancement if there were actual changes to orders
      if (changed || existingOrders.length === 0) {
        this.logApiActivity({
          type: 'mysql-write-with-shiprocket-data',
          rows: flatOrders.length,
          preservedClaims: existingClaimData.size
        });

        // Automatically enhance orders with product images (customer names already available from Shiprocket)
        try {
          const orderEnhancementService = require('./orderEnhancementService');
          const enhancementResult = await orderEnhancementService.enhanceOrdersMySQL();
          this.logApiActivity({
            type: 'orders-enhancement',
            success: enhancementResult.success,
            customerNamesAdded: enhancementResult.customerNamesAdded,
            productImagesAdded: enhancementResult.productImagesAdded,
            message: enhancementResult.message
          });
        } catch (enhancementError) {
          this.logApiActivity({
            type: 'orders-enhancement-error',
            error: enhancementError.message
          });
        }

        // Automatically populate customer_info table from Shiprocket orders
        try {
          console.log('📋 Populating customer_info table from Shiprocket orders...');
          let customerInfoCount = 0;

          for (const order of shiprocketOrders) {
            // Split customer_name into firstname and lastname
            const nameParts = (order.customer_name || '').trim().split(/\s+/);
            const firstName = nameParts[0] || null;
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            const customerData = {
              order_id: order.channel_order_id,
              account_code: this.accountCode,
              store_code: '1',
              email: order.customer_email || null,
              // Billing info — mapped from customer fields
              billing_firstname: firstName,
              billing_lastname: lastName,
              billing_phone: order.customer_phone || null,
              billing_address: order.customer_address || null,
              billing_address2: order.customer_address_2 || null,
              billing_city: order.customer_city || null,
              billing_state: order.customer_state || null,
              billing_country: order.customer_country || null,
              billing_zipcode: order.customer_pincode || null,
              billing_latitude: order.customer_latitude || null,
              billing_longitude: order.customer_longitude || null,
              // Shipping info — same as billing for Shiprocket
              shipping_firstname: firstName,
              shipping_lastname: lastName,
              shipping_phone: order.customer_phone || null,
              shipping_address: order.customer_address || null,
              shipping_address2: order.customer_address_2 || null,
              shipping_city: order.customer_city || null,
              shipping_state: order.customer_state || null,
              shipping_country: order.customer_country || null,
              shipping_zipcode: order.customer_pincode || null,
              shipping_latitude: order.customer_latitude || null,
              shipping_longitude: order.customer_longitude || null
            };

            await database.upsertCustomerInfo(customerData);
            customerInfoCount++;
          }

          console.log(`✅ Customer info populated: ${customerInfoCount} records`);
          this.logApiActivity({
            type: 'customer-info-sync',
            success: true,
            customerInfoCount: customerInfoCount,
            message: `Successfully populated ${customerInfoCount} customer info records`
          });
        } catch (customerInfoError) {
          console.error('⚠️ Failed to populate customer_info:', customerInfoError.message);
          this.logApiActivity({
            type: 'customer-info-sync-error',
            error: customerInfoError.message
          });
        }
      } else {
        this.logApiActivity({ type: 'mysql-no-change-but-flags-updated', rows: flatOrders.length });
      }
    } catch (mysqlError) {
      this.logApiActivity({ type: 'mysql-write-error', error: mysqlError.message });
      throw new Error('Failed to update MySQL database: ' + mysqlError.message);
    }

    return { success: true, count: flatOrders.length, preservedClaims: existingClaimData.size, rawDataStored: rawDataJsonPath };
  }

  /**
   * Sync carriers/couriers from Shiprocket API to MySQL database.
   * Preserves admin-set priorities and only adds new carriers.
   * Same pattern as ShipwayCarrierService.syncCarriersToMySQL().
   * @returns {Promise<Object>} Result of the operation
   */
  async syncCarriersToMySQL() {
    // Initialize service if not already initialized
    await this.initialize();

    try {
      console.log(`🔵 SHIPROCKET CARRIER: Starting smart carrier sync to MySQL (${this.accountCode})...`);

      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      if (!database.isMySQLAvailable()) {
        throw new Error('MySQL connection not available');
      }

      // 1. Read existing carriers from database (preserves admin-set priorities)
      let existingCarriers = [];
      if (this.accountCode) {
        existingCarriers = await database.getCarriersByAccountCode(this.accountCode);
      } else {
        existingCarriers = await database.getAllCarriers();
      }
      const existingCarrierMap = new Map(existingCarriers.map(c => [String(c.carrier_id), c]));

      console.log(`📊 Existing carriers: ${existingCarriers.length}`);

      // 2. Fetch couriers from Shiprocket API
      console.log(`📄 Fetching couriers from Shiprocket API...`);
      const url = `${this.baseURL}/courier/courierListWithCounts`;

      const response = await axios.get(url, {
        headers: {
          'Authorization': this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      if (response.status !== 200 || !response.data) {
        throw new Error('Invalid response from Shiprocket courier API');
      }

      const courierData = response.data.courier_data;
      if (!Array.isArray(courierData)) {
        throw new Error('Unexpected Shiprocket courier API response format: courier_data is not an array');
      }

      console.log(`✅ Fetched ${courierData.length} couriers from Shiprocket API`);

      // 3. Extract carrier data from Shiprocket response
      const newCarriersFromAPI = courierData.map((courier, index) => ({
        carrier_id: String(courier.id || `SR_COURIER_${index + 1}`),
        carrier_name: courier.name || 'Unknown Courier',
        status: 'Active',
        weight_in_kg: courier.min_weight || null,
        priority: index + 1,
        account_code: this.accountCode
      }));

      const newCarrierMap = new Map(newCarriersFromAPI.map(c => [String(c.carrier_id), c]));

      console.log(`📊 Couriers from API: ${newCarriersFromAPI.length}`);

      // 4. Find new carriers (not in existing database)
      const newCarrierIds = newCarriersFromAPI.filter(c => !existingCarrierMap.has(String(c.carrier_id)));
      console.log(`📊 New couriers to add: ${newCarrierIds.length}`);

      // 5. Find removed carriers (in existing database but not in API)
      const removedCarrierIds = existingCarriers.filter(c => !newCarrierMap.has(String(c.carrier_id)));
      console.log(`📊 Removed couriers: ${removedCarrierIds.length}`);

      // 6. Calculate next available priority for new carriers
      const existingPriorities = existingCarriers.map(c => parseInt(c.priority) || 0);
      const maxPriority = Math.max(0, ...existingPriorities);
      let nextPriority = maxPriority + 1;

      // 7. Build final carrier list
      const finalCarriers = [];

      // Process existing carriers (preserve priorities, update status/name/weight)
      existingCarriers
        .filter(c => !this.accountCode || c.account_code === this.accountCode)
        .forEach(existingCarrier => {
          const apiCarrier = newCarrierMap.get(String(existingCarrier.carrier_id));

          if (apiCarrier) {
            // Carrier still exists in API - keep priority, update other fields
            finalCarriers.push({
              ...existingCarrier,
              account_code: this.accountCode || existingCarrier.account_code,
              status: apiCarrier.status,
              carrier_name: apiCarrier.carrier_name,
              weight_in_kg: apiCarrier.weight_in_kg
            });
          }
          // If carrier doesn't exist in API, it gets removed (not added to finalCarriers)
        });

      // Add new carriers with next available priority
      newCarrierIds.forEach(newCarrier => {
        finalCarriers.push({
          ...newCarrier,
          account_code: this.accountCode || newCarrier.account_code,
          priority: nextPriority++
        });
        console.log(`➕ Added new courier: ${newCarrier.carrier_id} - ${newCarrier.carrier_name} with priority ${nextPriority - 1}`);
      });

      // Re-sort by priority and renumber sequentially (1, 2, 3...)
      finalCarriers.sort((a, b) => {
        const priorityA = parseInt(a.priority) || 0;
        const priorityB = parseInt(b.priority) || 0;
        return priorityA - priorityB;
      });

      finalCarriers.forEach((carrier, index) => {
        carrier.priority = index + 1;
      });

      // Filter to only include carriers for this store
      const storeCarriers = finalCarriers.filter(c =>
        !this.accountCode || c.account_code === this.accountCode
      );

      console.log(`📊 Final couriers for store ${this.accountCode}: ${storeCarriers.length}`);

      // 8. Save to MySQL database
      const result = await database.bulkUpsertCarriers(storeCarriers);

      // 9. Normalize priorities after sync
      if (this.accountCode && storeCarriers.length > 0) {
        await database.reorderCarrierPriorities(
          storeCarriers.filter(c => String(c.status || '').trim().toLowerCase() === 'active'),
          this.accountCode
        );
      }

      console.log('✅ SHIPROCKET CARRIER: Smart carrier sync completed');
      console.log(`📊 Summary: ${newCarrierIds.length} added, ${removedCarrierIds.length} removed, ${storeCarriers.length} total`);

      this.logApiActivity({
        type: 'shiprocket-carrier-sync',
        success: true,
        total: storeCarriers.length,
        added: newCarrierIds.length,
        removed: removedCarrierIds.length
      });

      return {
        success: true,
        message: `Successfully synced ${storeCarriers.length} couriers`,
        carrierCount: storeCarriers.length,
        inserted: result.inserted,
        updated: result.updated
      };
    } catch (error) {
      console.error('💥 SHIPROCKET CARRIER: Error syncing couriers to MySQL:', error.message);
      this.logApiActivity({
        type: 'shiprocket-carrier-sync-error',
        error: error.message
      });
      throw new Error(`Failed to sync Shiprocket couriers: ${error.message}`);
    }
  }

  /**
   * Prepare request body for Shiprocket Create Adhoc Order API
   * Used for clone orders (manual/custom orders, not channel-linked)
   * API: /orders/create/adhoc
   * @param {string} orderId - Order ID (clone ID or original)
   * @param {Array} products - Products array from orders table
   * @param {Object} customerInfo - Customer info from customer_info table
   * @param {string} pickupLocation - Pickup location from wh_mapping
   * @returns {Object} Request body for Create Adhoc Order API
   */
  prepareCreateOrderBody(orderId, products, customerInfo, pickupLocation) {
    // Get customer first and last name directly from database columns
    const firstName = (customerInfo.billing_firstname || '').trim();
    const lastName = (customerInfo.billing_lastname || '').trim();

    // Validate and sanitize billing_phone (required by Shiprocket API - must be 10 digits)
    let billingPhone = customerInfo.billing_phone || customerInfo.shipping_phone || '';
    // Remove any non-digit characters
    billingPhone = String(billingPhone).replace(/\D/g, '');
    // Validate phone number is exactly 10 digits
    if (!billingPhone || billingPhone.length !== 10) {
      throw new Error(`Invalid or missing billing phone number for order ${orderId}. Phone number must be exactly 10 digits. Current value: ${customerInfo.billing_phone || customerInfo.shipping_phone || 'missing'}`);
    }
    const billingPhoneInt = parseInt(billingPhone, 10);

    // Calculate sub_total (sum of collectable_amount)
    const subTotal = products.reduce((sum, product) => {
      return sum + (parseFloat(product.collectable_amount) || 0);
    }, 0);

    // Calculate total quantity for weight calculation
    const totalQuantity = products.reduce((sum, product) => sum + (parseInt(product.quantity) || 1), 0);
    const weight = 0.35 * totalQuantity; // Default weight: 0.35kg × total quantity

    // Determine payment_method
    const paymentType = products[0]?.payment_type || 'P';
    const paymentMethod = paymentType === 'P' ? 'Prepaid' : 'COD';

    // Format order_date as "YYYY-MM-DD HH:mm"
    let orderDate = products[0]?.order_date || null;
    if (orderDate) {
      // If order_date is already in MySQL format (YYYY-MM-DD HH:MM:SS), convert to Shiprocket format
      const date = new Date(orderDate);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        orderDate = `${year}-${month}-${day} ${hours}:${minutes}`;
      }
    }

    // Build order_items array (adhoc API uses number types for selling_price)
    const orderItems = products.map(product => ({
      name: product.product_name || '',
      sku: product.product_code || '',
      units: parseInt(product.quantity) || 1,
      selling_price: parseFloat(product.selling_price) || 0,
      discount: '',
      tax: '',
      hsn: ''
    }));

    // Adhoc API body: no channel_id, numeric types for pincode/phone/selling_price
    const requestBody = {
      order_id: orderId,
      order_date: orderDate || new Date().toISOString().replace('T', ' ').substring(0, 16),
      pickup_location: pickupLocation || '',
      comment: '',
      billing_customer_name: firstName,
      billing_last_name: lastName,
      billing_address: customerInfo.billing_address || '',
      billing_address_2: customerInfo.billing_address2 || '',
      billing_city: customerInfo.billing_city || '',
      billing_pincode: parseInt(customerInfo.billing_zipcode) || 0,
      billing_state: customerInfo.billing_state || '',
      billing_country: customerInfo.billing_country || 'India',
      billing_email: customerInfo.email || '',
      billing_phone: billingPhoneInt,
      shipping_is_billing: true,
      shipping_customer_name: '',
      shipping_last_name: '',
      shipping_address: '',
      shipping_address_2: '',
      shipping_city: '',
      shipping_pincode: '',
      shipping_country: '',
      shipping_state: '',
      shipping_email: '',
      shipping_phone: '',
      order_items: orderItems,
      payment_method: paymentMethod,
      shipping_charges: 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: 0,
      sub_total: subTotal,
      length: 22,
      breadth: 20,
      height: 4,
      weight: weight
    };

    return requestBody;
  }

  /**
   * Prepare request body for Shiprocket Update Order API
   * @param {string} orderId - Original order ID
   * @param {Array} products - Remaining products array from orders table
   * @param {Object} customerInfo - Customer info from customer_info table
   * @param {string} pickupLocation - Pickup location from wh_mapping
   * @returns {Object} Request body for Update Order API
   */
  prepareUpdateOrderBody(orderId, products, customerInfo, pickupLocation) {
    // Get customer first and last name directly from database columns
    const firstName = (customerInfo.billing_firstname || '').trim();
    const lastName = (customerInfo.billing_lastname || '').trim();

    // Validate and sanitize billing_phone (required by Shiprocket API - must be 10 digits)
    let billingPhone = customerInfo.billing_phone || customerInfo.shipping_phone || '';
    // Remove any non-digit characters
    billingPhone = String(billingPhone).replace(/\D/g, '');
    // Validate phone number is exactly 10 digits
    if (!billingPhone || billingPhone.length !== 10) {
      throw new Error(`Invalid or missing billing phone number for order ${orderId}. Phone number must be exactly 10 digits. Current value: ${customerInfo.billing_phone || customerInfo.shipping_phone || 'missing'}`);
    }
    const billingPhoneInt = parseInt(billingPhone, 10);

    // Calculate sub_total (sum of collectable_amount)
    const subTotal = products.reduce((sum, product) => {
      return sum + (parseFloat(product.collectable_amount) || 0);
    }, 0);

    // Calculate total quantity for weight calculation
    const totalQuantity = products.reduce((sum, product) => sum + (parseInt(product.quantity) || 1), 0);
    const weight = 0.35 * totalQuantity; // Default weight: 0.35kg × total quantity

    // Determine payment_method
    const paymentType = products[0]?.payment_type || 'P';
    const paymentMethod = paymentType === 'P' ? 'Prepaid' : 'COD';

    // Format order_date as "YYYY-MM-DD HH:mm"
    let orderDate = products[0]?.order_date || null;
    if (orderDate) {
      // If order_date is already in MySQL format (YYYY-MM-DD HH:MM:SS), convert to Shiprocket format
      const date = new Date(orderDate);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        orderDate = `${year}-${month}-${day} ${hours}:${minutes}`;
      }
    }

    // Build order_items array
    const orderItems = products.map(product => ({
      name: product.product_name || '',
      sku: product.product_code || '',
      units: parseInt(product.quantity) || 1,
      selling_price: String(parseFloat(product.selling_price) || 0),
      discount: '',
      tax: '',
      hsn: ''
    }));

    const requestBody = {
      order_id: orderId,
      order_date: orderDate || new Date().toISOString().replace('T', ' ').substring(0, 16),
      pickup_location: pickupLocation || '',
      channel_id: products[0]?.channel_id || '',
      comment: '',
      billing_customer_name: firstName,
      billing_last_name: lastName,
      billing_address: customerInfo.billing_address || '',
      billing_address_2: customerInfo.billing_address2 || '',
      billing_city: customerInfo.billing_city || '',
      billing_pincode: customerInfo.billing_zipcode || '',
      billing_state: customerInfo.billing_state || '',
      billing_country: customerInfo.billing_country || 'India',
      billing_email: customerInfo.email || '',
      billing_phone: billingPhoneInt,
      shipping_is_billing: true,
      shipping_customer_name: '',
      shipping_last_name: '',
      shipping_address: '',
      shipping_address_2: '',
      shipping_city: '',
      shipping_pincode: '',
      shipping_country: '',
      shipping_state: '',
      shipping_email: '',
      shipping_phone: '',
      is_document: '0',
      order_items: orderItems,
      payment_method: paymentMethod,
      shipping_charges: 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: 0,
      sub_total: subTotal,
      length: 22,
      breadth: 20,
      height: 4,
      weight: weight
    };

    return requestBody;
  }

  /**
   * Call Shiprocket Create Adhoc Order API (for clone/manual orders)
   * API: /orders/create/adhoc (no channel_id needed)
   * @param {Object} requestBody - Request body for Create Adhoc Order API
   * @returns {Promise<Object>} API response with shipment_id
   */
  async createOrder(requestBody) {
    await this.initialize();

    const url = `${this.baseURL}/orders/create/adhoc`;

    console.log('🔄 Calling Shiprocket Create Adhoc Order API');
    console.log('  - Order ID:', requestBody.order_id);
    console.log('  - Account Code:', this.accountCode);

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      console.log('✅ Shiprocket Create Order API call successful');
      console.log('  - Response status:', response.status);
      console.log('  - Order ID:', requestBody.order_id);

      return {
        success: true,
        data: response.data,
        order_id: requestBody.order_id
      };
    } catch (error) {
      console.error('❌ Shiprocket Create Order API call failed:', error.message);
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', JSON.stringify(error.response.data, null, 2));
        throw new Error(`Shiprocket Create Order API failed: ${error.response.data?.message || error.message}`);
      }
      throw new Error(`Shiprocket Create Order API failed: ${error.message}`);
    }
  }

  /**
   * Call Shiprocket Update Order API
   * @param {Object} requestBody - Request body for Update Order API
   * @returns {Promise<Object>} API response
   */
  async updateOrder(requestBody) {
    await this.initialize();

    const url = `${this.baseURL}/orders/update/adhoc`;

    console.log('🔄 Calling Shiprocket Update Order API');
    console.log('  - Order ID:', requestBody.order_id);
    console.log('  - Account Code:', this.accountCode);

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      console.log('✅ Shiprocket Update Order API call successful');
      console.log('  - Response status:', response.status);
      console.log('  - Order ID:', requestBody.order_id);

      return {
        success: true,
        data: response.data,
        order_id: requestBody.order_id
      };
    } catch (error) {
      console.error('❌ Shiprocket Update Order API call failed:', error.message);
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', JSON.stringify(error.response.data, null, 2));
        throw new Error(`Shiprocket Update Order API failed: ${error.response.data?.message || error.message}`);
      }
      throw new Error(`Shiprocket Update Order API failed: ${error.message}`);
    }
  }

  /**
   * Change pickup address for Shiprocket orders (bulk API)
   * API: PATCH /orders/address/pickup
   * @param {Array<number>} partnerOrderIds - Array of partner_order_ids (order.id from Shiprocket, integer type)
   * @param {string} pickupLocation - Pickup location name from wh_mapping
   * @returns {Promise<Object>} API response
   */
  async changePickupAddress(partnerOrderIds, pickupLocation) {
    await this.initialize();

    const url = `${this.baseURL}/orders/address/pickup`;

    // Ensure partner_order_ids are integers
    const intPartnerOrderIds = partnerOrderIds.map(id => parseInt(id));

    const requestBody = {
      order_id: intPartnerOrderIds,
      pickup_location: pickupLocation
    };

    console.log('🔄 Calling Shiprocket Change Pickup Address API');
    console.log('  - Partner Order IDs (order.id):', intPartnerOrderIds);
    console.log('  - Pickup Location:', pickupLocation);
    console.log('  - Account Code:', this.accountCode);

    try {
      const response = await axios.patch(url, requestBody, {
        headers: {
          'Authorization': this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      console.log('✅ Shiprocket Change Pickup Address API call successful');
      console.log('  - Response status:', response.status);

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('❌ Shiprocket Change Pickup Address API call failed:', error.message);
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', JSON.stringify(error.response.data, null, 2));
        throw new Error(`Shiprocket Change Pickup Address failed: ${error.response.data?.message || error.message}`);
      }
      throw new Error(`Shiprocket Change Pickup Address failed: ${error.message}`);
    }
  }

  /**
   * Assign AWB for a single shipment (with courier_id)
   * API: POST /courier/assign/awb
   * @param {string|number} shipmentId - Shipment ID
   * @param {string|number} courierId - Courier/carrier ID
   * @returns {Promise<Object>} API response with awb_code, courier details
   */
  async assignAWB(shipmentId, courierId) {
    await this.initialize();

    const url = `${this.baseURL}/courier/assign/awb`;

    const requestBody = {
      shipment_id: String(shipmentId),
      courier_id: String(courierId)
    };

    console.log('🔄 Calling Shiprocket Assign AWB API');
    console.log('  - Shipment ID:', shipmentId);
    console.log('  - Courier ID:', courierId);
    console.log('  - Account Code:', this.accountCode);

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      const data = response.data;

      // Check awb_assign_status: 1 = success, 0 = failure
      if (data.awb_assign_status === 1 && data.response?.data?.awb_code) {
        console.log('✅ Shiprocket AWB assigned successfully');
        console.log('  - AWB Code:', data.response.data.awb_code);
        console.log('  - Courier:', data.response.data.courier_name);

        return {
          success: true,
          awb_code: data.response.data.awb_code,
          courier_company_id: data.response.data.courier_company_id,
          courier_name: data.response.data.courier_name,
          shipment_id: data.response.data.shipment_id,
          data: data
        };
      } else {
        console.log('❌ Shiprocket AWB assign failed (awb_assign_status=0)');
        console.log('  - Response:', JSON.stringify(data, null, 2));
        return {
          success: false,
          message: data.message || data.response?.data?.message || 'AWB assignment failed',
          data: data
        };
      }
    } catch (error) {
      console.error('❌ Shiprocket Assign AWB API call failed:', error.message);
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', JSON.stringify(error.response.data, null, 2));
      }
      return {
        success: false,
        message: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Generate labels for multiple shipments (bulk API)
   * API: POST /courier/generate/label
   * @param {Array<number>} shipmentIds - Array of shipment_ids (integer type)
   * @param {string} format - Label format: 'thermal', 'a4', or 'four-in-one'
   * @returns {Promise<Object>} API response with label_url
   */
  async generateLabel(shipmentIds, format = 'thermal') {
    await this.initialize();

    const url = `${this.baseURL}/courier/generate/label`;

    // Ensure shipment_ids are integers
    const intShipmentIds = shipmentIds.map(id => parseInt(id));

    // Map our format names to Shiprocket API params
    let requestBody;
    if (format === 'thermal') {
      requestBody = {
        shipment_id: intShipmentIds,
        label_format: '4x6'
      };
    } else if (format === 'a4') {
      requestBody = {
        shipment_id: intShipmentIds,
        label_format: 'A4',
        print_format: '1'
      };
    } else if (format === 'four-in-one') {
      requestBody = {
        shipment_id: intShipmentIds,
        label_format: 'A4',
        print_format: '4'
      };
    } else {
      // Default to thermal
      requestBody = {
        shipment_id: intShipmentIds,
        label_format: '4x6'
      };
    }

    console.log('🔄 Calling Shiprocket Generate Label API');
    console.log('  - Shipment IDs:', intShipmentIds);
    console.log('  - Format:', format);
    console.log('  - Account Code:', this.accountCode);

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 60000, // 60s timeout for bulk label generation
      });

      const data = response.data;

      if (data.label_created === 1 && data.label_url) {
        console.log('✅ Shiprocket Label generated successfully');
        console.log('  - Label URL:', data.label_url);
        console.log('  - Not created:', data.not_created);

        return {
          success: true,
          label_url: data.label_url,
          not_created: data.not_created || [],
          data: data
        };
      } else {
        console.log('❌ Shiprocket Label generation failed');
        console.log('  - Response:', JSON.stringify(data, null, 2));
        return {
          success: false,
          message: data.response || 'Label generation failed',
          not_created: data.not_created || [],
          data: data
        };
      }
    } catch (error) {
      console.error('❌ Shiprocket Generate Label API call failed:', error.message);
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', JSON.stringify(error.response.data, null, 2));
        throw new Error(`Shiprocket Generate Label failed: ${error.response.data?.message || error.message}`);
      }
      throw new Error(`Shiprocket Generate Label failed: ${error.message}`);
    }
  }

  /**
   * Request pickup for a single shipment
   * API: POST /courier/generate/pickup
   * @param {string|number} shipmentId - Shipment ID (shipment.id from orders table)
   * @returns {Promise<Object>} API response with pickup status
   */
  async generatePickup(shipmentId) {
    await this.initialize();

    const url = `${this.baseURL}/courier/generate/pickup`;

    const requestBody = {
      shipment_id: [parseInt(shipmentId)]
    };

    console.log('🔄 Calling Shiprocket Generate Pickup API');
    console.log('  - Shipment ID:', shipmentId);
    console.log('  - Account Code:', this.accountCode);

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      const data = response.data;

      if (data.pickup_status === 1) {
        console.log('✅ Shiprocket Pickup requested successfully');
        console.log('  - Pickup Scheduled Date:', data.response?.pickup_scheduled_date);
        console.log('  - Pickup Token Number:', data.response?.pickup_token_number);

        return {
          success: true,
          pickup_status: data.pickup_status,
          pickup_scheduled_date: data.response?.pickup_scheduled_date,
          pickup_token_number: data.response?.pickup_token_number,
          data: data
        };
      } else {
        console.log('❌ Shiprocket Pickup request failed');
        console.log('  - Response:', JSON.stringify(data, null, 2));
        return {
          success: false,
          message: data.response?.data || data.message || 'Pickup request failed',
          data: data
        };
      }
    } catch (error) {
      console.error('❌ Shiprocket Generate Pickup API call failed:', error.message);
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', JSON.stringify(error.response.data, null, 2));
      }
      return {
        success: false,
        message: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Generate manifest for multiple shipments (bulk API)
   * API: POST /manifests/generate
   * @param {Array<number>} shipmentIds - Array of shipment_ids (integer type)
   * @returns {Promise<Object>} API response with manifest_url
   */
  async generateManifest(shipmentIds) {
    await this.initialize();

    const url = `${this.baseURL}/manifests/generate`;

    // Ensure shipment_ids are integers
    const intShipmentIds = shipmentIds.map(id => parseInt(id));

    const requestBody = {
      shipment_id: intShipmentIds
    };

    console.log('🔄 Calling Shiprocket Generate Manifest API');
    console.log('  - Shipment IDs:', intShipmentIds);
    console.log('  - Account Code:', this.accountCode);

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': this.authToken,
          'Content-Type': 'application/json',
        },
        timeout: 60000, // 60s timeout for bulk manifest generation
      });

      const data = response.data;

      if (data.status === 1 && data.manifest_url) {
        console.log('✅ Shiprocket Manifest generated successfully');
        console.log('  - Manifest URL:', data.manifest_url);

        return {
          success: true,
          manifest_url: data.manifest_url,
          data: data
        };
      } else {
        console.log('❌ Shiprocket Manifest generation failed');
        console.log('  - Response:', JSON.stringify(data, null, 2));
        return {
          success: false,
          message: data.message || 'Manifest generation failed',
          data: data
        };
      }
    } catch (error) {
      console.error('❌ Shiprocket Generate Manifest API call failed:', error.message);
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', JSON.stringify(error.response.data, null, 2));
        throw new Error(`Shiprocket Generate Manifest failed: ${error.response.data?.message || error.message}`);
      }
      throw new Error(`Shiprocket Generate Manifest failed: ${error.message}`);
    }
  }

  logApiActivity(activity) {
    const logPath = path.join(__dirname, '../logs/api.log');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [Shiprocket] ${JSON.stringify(activity)}\n`;
    fs.appendFile(logPath, logEntry, err => {
      if (err) console.error('Failed to write API log:', err);
    });
  }
}

module.exports = ShiprocketService;
