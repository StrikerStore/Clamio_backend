const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const orderEnhancementService = require('./orderEnhancementService');

/**
 * Generate stable unique_id from order and product data
 * @param {string} orderId - Order ID
 * @param {string} productCode - Product code
 * @param {number} itemIndex - Item index in order (for duplicate products in same order)
 * @returns {string} Stable unique_id
 */
function generateStableUniqueId(orderId, productCode, itemIndex = 0) {
  const id = `${orderId}_${productCode}_${itemIndex}`;
  return crypto.createHash('md5').update(id).digest('hex').substring(0, 12).toUpperCase();
}

/**
 * Shipway API Service
 * Handles all interactions with Shipway API
 */
class ShipwayService {
  constructor() {
    this.baseURL = process.env.SHIPWAY_API_BASE_URL || 'https://app.shipway.com/api';
    // Instead of API key, use Basic Auth header from environment variable
    this.basicAuthHeader = process.env.SHIPWAY_BASIC_AUTH_HEADER;
  }

  /**
   * Get warehouse details by warehouse ID
   * @param {string} warehouseId - The warehouse ID to fetch details for
   * @returns {Object} Warehouse details from Shipway API
   */
  async getWarehouseById(warehouseId) {
    try {
      if (!warehouseId) {
        throw new Error('Warehouse ID is required');
      }

      if (!this.basicAuthHeader) {
        throw new Error('Shipway API configuration error. Please contact administrator.');
      }

      const url = `${this.baseURL}/getwarehouses`;
      const params = { warehouseid: warehouseId };

      this.logApiActivity({
        type: 'shipway-request',
        warehouseId,
        url,
        params,
        headers: { Authorization: '***' },
      });
      const response = await axios.get(url, {
        params,
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });
      this.logApiActivity({
        type: 'shipway-response',
        warehouseId,
        status: response.status,
        data: response.data,
      });

      // Check if response is successful
      if (response.status !== 200) {
        throw new Error(`Shipway API returned status ${response.status}`);
      }

      const data = response.data;

      // Validate response structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from Shipway API');
      }

      // Shipway sometimes returns { success: 1, message: 'No warehouse found' }
      // or other non-object message values when not found. Treat those as not found.
      const messageField = data.message;
      const messageIsObject = messageField && typeof messageField === 'object';
      const messageIsNoWarehouse = typeof messageField === 'string' && messageField.toLowerCase().includes('no warehouse');

      if (data.error || !messageIsObject || messageIsNoWarehouse) {
        throw new Error('Warehouse not found or invalid warehouse ID');
      }

      return {
        success: true,
        data: data,
        warehouseId: warehouseId
      };

    } catch (error) {
      // Check if this is an expected validation failure (warehouse not found)
      const isValidationFailure = error.message.includes('Warehouse not found') || 
                                  error.message.includes('not found') ||
                                  error.message.includes('Invalid warehouse ID');

      this.logApiActivity({
        type: isValidationFailure ? 'shipway-validation-failure' : 'shipway-error',
        warehouseId,
        error: error.message,
        stack: error.stack,
      });

      if (isValidationFailure) {
        console.log('⚠️ Warehouse validation failed (expected):', {
          warehouseId,
          reason: error.message
        });
      } else {
        console.error('Error fetching for warehouseId:', warehouseId, 'from Shipway API:', error.message);
      }
      
      // Handle specific error cases
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Shipway API. Please check your internet connection.');
      }
      
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Request to Shipway API timed out. Please try again.');
      }

      if (error.response) {
        // API returned an error response
        const status = error.response.status;
        if (status === 401) {
          throw new Error('Invalid Shipway API credentials. Please check your configuration.');
        } else if (status === 404) {
          throw new Error('Warehouse not found with the provided ID.');
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else {
          throw new Error(`Shipway API error: ${error.response.data?.message || `Status ${status}`}`);
        }
      }

      // Re-throw the original error if it's already formatted
      if (error.message.includes('Warehouse not found') || 
          error.message.includes('Shipway API')) {
        throw error;
      }

      throw new Error('Failed to fetch warehouse details from Shipway API');
    }
  }

  /**
   * Validate warehouse ID format
   * @param {string} warehouseId - The warehouse ID to validate
   * @returns {boolean} True if valid format, false otherwise
   */
  validateWarehouseId(warehouseId) {
    if (!warehouseId || typeof warehouseId !== 'string') {
      return false;
    }

    // Remove any whitespace
    const cleanId = warehouseId.trim();
    
    // Check if it's a valid number (positive integer)
    const numId = parseInt(cleanId, 10);
    return !isNaN(numId) && numId > 0 && numId.toString() === cleanId;
  }

  /**
   * Extract key warehouse information from Shipway response
   * @param {Object} shipwayData - Raw data from Shipway API
   * @returns {Object} Formatted warehouse information
   */
  formatWarehouseData(shipwayData) {
    try {
      // If the response is wrapped in a 'message' key, use that
      const data = shipwayData && typeof shipwayData === 'object' && shipwayData.message ? shipwayData.message : shipwayData;
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid warehouse data');
      }
      const warehouse = {
        id: data.warehouse_id || data.warehouseid || data.id,
        name: data.title || data.warehousename || data.name,
        address: data.address_1 || data.address || data.warehouseaddress,
        city: data.city,
        state: data.state,
        country: data.country,
        pincode: data.pincode || data.postalcode,
        contactPerson: data.contact_person_name || data.contactperson || data.contact_person,
        phone: data.phone || data.contactphone,
        email: data.email || data.contactemail,
        status: data.status || data.warehousestatus,
        createdAt: data.createddate || data.created_at,
        updatedAt: data.updateddate || data.updated_at
      };
      Object.keys(warehouse).forEach(key => {
        if (warehouse[key] === undefined) {
          delete warehouse[key];
        }
      });
      return warehouse;
    } catch (error) {
      console.error('Error formatting warehouse data:', error);
      throw new Error('Failed to format warehouse data');
    }
  }

  /**
   * Test API connectivity
   * @returns {Object} Connection test result
   */
  async testConnection() {
    try {
      if (!this.basicAuthHeader) {
        return {
          success: false,
          error: 'API credentials not configured'
        };
      }

      // Try to fetch a test warehouse (you might want to use a known test ID)
      const testResult = await this.getWarehouseById('1');
      
      return {
        success: true,
        message: 'Successfully connected to Shipway API'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * @deprecated - Use syncOrdersToMySQL() instead
   * Old Excel-based sync method - kept for reference but not used
   */
  /*
  async syncOrdersToExcel() {
    const ordersExcelPath = path.join(__dirname, '../data/orders.xlsx');
    const rawDataJsonPath = path.join(__dirname, '../data/raw_shipway_orders.json');
    const url = `${this.baseURL}/getorders`;
    const params = { status: 'O' };
    let shipwayOrders = [];
    let rawApiResponse = null;
    
    try {
      // Fetch all orders using Shipway's page-based pagination
      let allOrders = [];
      let page = 1;
      let hasMorePages = true;
      
      console.log('🔄 Starting paginated fetch from Shipway API...');
      
      while (hasMorePages) {
        const currentParams = { 
          status: 'O',
          page: page
        };
        
        this.logApiActivity({ 
          type: 'shipway-request', 
          url, 
          params: currentParams, 
          headers: { Authorization: '***' },
          page: page
        });
        
        console.log(`📄 Fetching page ${page}...`);
        
        const response = await axios.get(url, {
          params: currentParams,
          headers: {
            'Authorization': this.basicAuthHeader,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        });
        
        if (response.status !== 200 || !response.data) {
          throw new Error('Invalid response from Shipway API');
        }
        
        let currentPageOrders = [];
        if (Array.isArray(response.data)) {
          currentPageOrders = response.data;
        } else if (Array.isArray(response.data.orders)) {
          currentPageOrders = response.data.orders;
        } else if (typeof response.data === 'object' && Array.isArray(response.data.message) && response.data.success === 1) {
          currentPageOrders = response.data.message;
        } else if (typeof response.data === 'object' && response.data.order_id) {
          currentPageOrders = [response.data];
        } else {
          this.logApiActivity({ type: 'shipway-unexpected-format', data: response.data });
          throw new Error('Unexpected Shipway API response format');
        }
        
        console.log(`  ✅ Page ${page}: ${currentPageOrders.length} orders`);
        
        // Add orders from this page to our collection
        allOrders = allOrders.concat(currentPageOrders);
        
        // If we got fewer than 100 orders, we've reached the last page
        if (currentPageOrders.length < 100) {
          hasMorePages = false;
          console.log(`  🏁 Last page reached (${currentPageOrders.length} < 100 orders)`);
        } else {
          console.log(`  ➡️ More pages available (${currentPageOrders.length} = 100 orders)`);
        }
        
        this.logApiActivity({ 
          type: 'shipway-page-fetched', 
          page: page, 
          ordersInPage: currentPageOrders.length, 
          totalOrdersSoFar: allOrders.length 
        });
        
        page++;
        
        // Safety check to prevent infinite loops
        if (page > 20) {
          console.log('⚠️ Safety limit reached (20 pages), stopping pagination');
          this.logApiActivity({ type: 'shipway-pagination-limit-reached', totalOrders: allOrders.length });
          break;
        }
      }
      
      console.log(`🎉 Pagination complete! Total orders fetched: ${allOrders.length}`);
      
      // Filter orders to only include last 60 days
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      
      const filteredOrders = allOrders.filter(order => {
        if (!order.order_date) return false;
        
        const orderDate = new Date(order.order_date);
        const isWithin40Days = orderDate >= sixtyDaysAgo;
        
        if (!isWithin40Days) {
          console.log(`  ⏰ Filtering out old order: ${order.order_id} (${order.order_date})`);
        }
        
        return isWithin40Days;
      });
      
      console.log(`📅 Date filter applied: ${filteredOrders.length} orders within last 40 days (filtered out ${allOrders.length - filteredOrders.length} old orders)`);
      
      shipwayOrders = filteredOrders;
      rawApiResponse = { success: 1, message: allOrders }; // Keep all orders in raw JSON
      
      // Store raw API response in JSON file (all orders)
      try {
        fs.writeFileSync(rawDataJsonPath, JSON.stringify(rawApiResponse, null, 2));
        this.logApiActivity({ type: 'raw-data-stored', path: rawDataJsonPath, totalOrders: allOrders.length, filteredOrders: filteredOrders.length });
      } catch (fileError) {
        this.logApiActivity({ type: 'raw-data-store-error', error: fileError.message });
      }
      
      this.logApiActivity({ 
        type: 'shipway-response', 
        status: 200, 
        dataType: typeof rawApiResponse, 
        dataKeys: Object.keys(rawApiResponse),
        totalOrders: allOrders.length,
        filteredOrders: filteredOrders.length
      });
      
    } catch (error) {
      this.logApiActivity({ type: 'shipway-error', error: error.message, stack: error.stack });
      throw new Error('Failed to fetch orders from Shipway API: ' + error.message);
    }


    // Initialize variables for MySQL data processing
    let existingClaimData = new Map(); // Map to store claim data by order_id|product_code
    let maxUniqueId = 0;

    // Flatten Shipway orders to one row per product, preserving existing claim data
    const flatOrders = [];
    let uniqueIdCounter = maxUniqueId + 1;

    // Function to generate stable unique_id
    function generateStableUniqueId(orderId, productCode, itemIndex = 0) {
      const crypto = require('crypto');
      const id = `${orderId}_${productCode}_${itemIndex}`;
      return crypto.createHash('md5').update(id).digest('hex').substring(0, 12).toUpperCase();
    }
    
    for (const order of shipwayOrders) {
      if (!Array.isArray(order.products)) continue;
      
      // Extract order-level financial information and convert to number
      const orderTotal = parseFloat(order.order_total) || 0;
      
      // Determine payment type based on order_tags
      const orderTags = Array.isArray(order.order_tags) ? order.order_tags : [];
      const paymentType = orderTags.includes('PPCOD') ? 'C' : 'P';
      
             // Calculate total prepaid amount for the entire order based on payment type
       const totalPrepaidAmount = paymentType === 'P' 
         ? parseFloat(orderTotal.toFixed(2)) 
         : parseFloat((orderTotal * 0.1).toFixed(2));
      
      // Calculate total selling price for all products in this order for ratio calculation
      const totalSellingPriceInOrder = order.products.reduce((sum, prod) => {
        return sum + (parseFloat(prod.price) || 0);
      }, 0);
      
             // Calculate ratio parts for each product
       let productRatios = [];
       if (totalSellingPriceInOrder > 0) {
         const prices = order.products.map(prod => parseFloat(prod.price) || 0);
         
         // Convert prices to integers to handle decimals (multiply by 100 for 2 decimal places)
         const intPrices = prices.map(price => Math.round(price * 100));
         
         // Find GCD of all prices to get simplest integer ratio
         const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
         const findGCD = (arr) => arr.reduce((acc, val) => gcd(acc, val));
         
         const pricesGCD = findGCD(intPrices.filter(p => p > 0));
         
         if (pricesGCD > 0) {
           productRatios = intPrices.map(price => Math.round(price / pricesGCD));
         } else {
           productRatios = prices.map(() => 1);
         }
       } else {
         productRatios = order.products.map(() => 1); // Equal ratio if no selling prices
       }
       
       // Calculate total of all ratios for this order
       const totalRatios = productRatios.reduce((sum, ratio) => sum + ratio, 0);
      
      for (let i = 0; i < order.products.length; i++) {
        const product = order.products[i];
        const key = `${order.order_id}|${product.product_code}`;
        const existingClaim = existingClaimData.get(key);
        
                          // Get selling price from product data and convert to number
         const sellingPrice = parseFloat(product.price) || 0;
         
         // Get the ratio for this product
         const orderTotalRatio = productRatios[i] || 1;
         
         // Calculate the actual split amount for this product
         const orderTotalSplit = totalRatios > 0 
           ? parseFloat(((orderTotalRatio / totalRatios) * orderTotal).toFixed(2))
           : parseFloat((orderTotal / order.products.length).toFixed(2)); // Equal split if no ratios
         
         // Calculate the prepaid amount split for this product based on ratio
         const prepaidAmount = totalRatios > 0 
           ? parseFloat(((orderTotalRatio / totalRatios) * totalPrepaidAmount).toFixed(2))
           : parseFloat((totalPrepaidAmount / order.products.length).toFixed(2)); // Equal split if no ratios
         
         // Calculate collectable amount: 0 for prepaid, order_total_split - prepaid_amount for COD
         const collectableAmount = paymentType === 'P' 
           ? 0 
           : parseFloat((orderTotalSplit - prepaidAmount).toFixed(2));
         
                                                         const orderRow = {
          unique_id: existingClaim ? existingClaim.unique_id : generateStableUniqueId(order.order_id, product.product_code, i),
          order_id: order.order_id,
          order_date: order.order_date,
          product_name: product.product,
          product_code: product.product_code,
          quantity: parseInt(product.amount) || 1,
          // The 7 additional columns with correct logic
          selling_price: sellingPrice,
          order_total: orderTotal,
          payment_type: paymentType,
          prepaid_amount: prepaidAmount,
          order_total_ratio: orderTotalRatio,
          order_total_split: orderTotalSplit,
          collectable_amount: collectableAmount,
          // Add pincode from s_zipcode, preserve existing if available
          pincode: existingClaim ? existingClaim.pincode : (order.s_zipcode || ''),
         // Preserve existing claim data or use defaults for new orders
         status: existingClaim ? existingClaim.status : 'unclaimed',
         claimed_by: existingClaim ? existingClaim.claimed_by : '',
         claimed_at: existingClaim ? existingClaim.claimed_at : '',
         last_claimed_by: existingClaim ? existingClaim.last_claimed_by : '',
         last_claimed_at: existingClaim ? existingClaim.last_claimed_at : '',
         clone_status: existingClaim ? existingClaim.clone_status : 'not_cloned',
         cloned_order_id: existingClaim ? existingClaim.cloned_order_id : '',
         is_cloned_row: existingClaim ? existingClaim.is_cloned_row : '',
         label_downloaded: existingClaim ? existingClaim.label_downloaded : '',
         handover_at: existingClaim ? existingClaim.handover_at : '',
         // Preserve custom columns or use empty defaults for new orders
         customer_name: existingClaim ? existingClaim.customer_name : '',
         // Add priority_carrier column (empty for new orders, preserve existing)
         priority_carrier: existingClaim ? existingClaim.priority_carrier : ''
        };
        
        flatOrders.push(orderRow);
      }
    }

    // Compare and update Excel only if changed or file doesn't exist
    const existingKeySet = new Set(existingRows.map(r => `${r.order_id}|${r.product_code}`));
    const newKeySet = new Set(flatOrders.map(r => `${r.order_id}|${r.product_code}`));
    let changed = false;
    
    // Check for new rows
    for (const row of flatOrders) {
      if (!existingKeySet.has(`${row.order_id}|${row.product_code}`)) {
        changed = true;
        break;
      }
    }
    
    // Check for removed rows
    if (!changed) {
      for (const row of existingRows) {
        if (!newKeySet.has(`${row.order_id}|${row.product_code}`)) {
          changed = true;
          break;
        }
      }
    }
    
        // Always create/update Excel file if it doesn't exist or if there are changes
    if (changed || !fs.existsSync(ordersExcelPath)) {
      // Write updated Excel file with preserved claim data and new columns
      const worksheet = XLSX.utils.json_to_sheet(flatOrders);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');
      XLSX.writeFile(workbook, ordersExcelPath);
             this.logApiActivity({ 
        type: 'excel-write-with-new-columns', 
        rows: flatOrders.length, 
        preservedClaims: existingClaimData.size,
        newColumns: ['quantity', 'selling_price', 'order_total', 'payment_type', 'prepaid_amount', 'order_total_ratio', 'order_total_split', 'collectable_amount', 'customer_name', 'priority_carrier', 'pincode']
      });

      // Automatically enhance orders with customer names and product images
      try {
        const enhancementResult = await orderEnhancementService.enhanceOrdersFile();
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

      // Automatically sync carriers from Shipway API
      try {
        const shipwayCarrierService = require('./shipwayCarrierService');
        const carrierResult = await shipwayCarrierService.syncCarriersToExcel();
        this.logApiActivity({ 
          type: 'carrier-sync', 
          success: carrierResult.success,
          carrierCount: carrierResult.carrierCount,
          message: carrierResult.message
        });
      } catch (carrierError) {
        this.logApiActivity({ 
          type: 'carrier-sync-error', 
          error: carrierError.message 
        });
      }
    } else {
      this.logApiActivity({ type: 'excel-no-change', rows: flatOrders.length });
    }
    
    return { success: true, count: flatOrders.length, preservedClaims: existingClaimData.size, rawDataStored: rawDataJsonPath };
  }
  */

  /**
   * Sync orders from Shipway API to MySQL database
   * Preserves existing claim data (status, claimed_by, etc.) when syncing new orders.
   * Only adds new orders and updates existing orders when there are actual data changes.
   * Prevents unnecessary overriding of existing order data.
   * Logs all API activity.
   * Stores raw API response in JSON file for reference.
   */
  async syncOrdersToMySQL() {
    const database = require('../config/database');
    const rawDataJsonPath = path.join(__dirname, '../data/raw_shipway_orders.json');
    const url = `${this.baseURL}/getorders`;
    let shipwayOrders = [];
    let rawApiResponse = null;
    
    try {
      // Fetch all orders using Shipway's page-based pagination
      let allOrders = [];
      let page = 1;
      let hasMorePages = true;
      
      console.log('🔄 Starting paginated fetch from Shipway API...');
      
      while (hasMorePages) {
        const currentParams = { 
          status: 'O',
          page: page
        };
        
        this.logApiActivity({ 
          type: 'shipway-request', 
          url, 
          params: currentParams, 
          headers: { Authorization: '***' },
          page: page
        });
        
        console.log(`📄 Fetching page ${page}...`);
        
        const response = await axios.get(url, {
          params: currentParams,
          headers: {
            'Authorization': this.basicAuthHeader,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        });
        
        if (response.status !== 200 || !response.data) {
          throw new Error('Invalid response from Shipway API');
        }
        
        let currentPageOrders = [];
        if (Array.isArray(response.data)) {
          currentPageOrders = response.data;
        } else if (Array.isArray(response.data.orders)) {
          currentPageOrders = response.data.orders;
        } else if (typeof response.data === 'object' && Array.isArray(response.data.message) && response.data.success === 1) {
          currentPageOrders = response.data.message;
        } else if (typeof response.data === 'object' && response.data.order_id) {
          currentPageOrders = [response.data];
        } else {
          this.logApiActivity({ type: 'shipway-unexpected-format', data: response.data });
          throw new Error('Unexpected Shipway API response format');
        }
        
        console.log(`  ✅ Page ${page}: ${currentPageOrders.length} orders`);
        
        // Add orders from this page to our collection
        allOrders = allOrders.concat(currentPageOrders);
        
        // If we got fewer than 100 orders, we've reached the last page
        if (currentPageOrders.length < 100) {
          hasMorePages = false;
          console.log(`  🏁 Last page reached (${currentPageOrders.length} < 100 orders)`);
        } else {
          console.log(`  ➡️ More pages available (${currentPageOrders.length} = 100 orders)`);
        }
        
        this.logApiActivity({ 
          type: 'shipway-page-fetched', 
          page: page, 
          ordersInPage: currentPageOrders.length, 
          totalOrdersSoFar: allOrders.length 
        });
        
        page++;
        
        // Safety check to prevent infinite loops
        if (page > 20) {
          console.log('⚠️ Safety limit reached (20 pages), stopping pagination');
          this.logApiActivity({ type: 'shipway-pagination-limit-reached', totalOrders: allOrders.length });
          break;
        }
      }
      
      console.log(`🎉 Pagination complete! Total orders fetched: ${allOrders.length}`);
      
      // Filter orders to only include last 40 days
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      
      const filteredOrders = allOrders.filter(order => {
        if (!order.order_date) return false;
        
        const orderDate = new Date(order.order_date);
        const isWithin40Days = orderDate >= sixtyDaysAgo;
        
        if (!isWithin40Days) {
          console.log(`  ⏰ Filtering out old order: ${order.order_id} (${order.order_date})`);
        }
        
        return isWithin40Days;
      });
      
      console.log(`📅 Date filter applied: ${filteredOrders.length} orders within last 40 days (filtered out ${allOrders.length - filteredOrders.length} old orders)`);
      
      shipwayOrders = filteredOrders;
      rawApiResponse = { success: 1, message: allOrders }; // Keep all orders in raw JSON
      
      // Store raw API response in JSON file (all orders)
      try {
        fs.writeFileSync(rawDataJsonPath, JSON.stringify(rawApiResponse, null, 2));
        this.logApiActivity({ type: 'raw-data-stored', path: rawDataJsonPath, totalOrders: allOrders.length, filteredOrders: filteredOrders.length });
      } catch (fileError) {
        this.logApiActivity({ type: 'raw-data-store-error', error: fileError.message });
      }
      
      this.logApiActivity({ 
        type: 'shipway-response', 
        status: 200, 
        dataType: typeof rawApiResponse, 
        dataKeys: Object.keys(rawApiResponse),
        totalOrders: allOrders.length,
        filteredOrders: filteredOrders.length
      });
      
    } catch (error) {
      this.logApiActivity({ type: 'shipway-error', error: error.message, stack: error.stack });
      throw new Error('Failed to fetch orders from Shipway API: ' + error.message);
    }

    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }

    // Get existing orders from MySQL to preserve claim data
    let existingOrders = [];
    let existingClaimData = new Map(); // Map to store claim data by order_id|product_code
    let maxUniqueId = 0;
    
    try {
      existingOrders = await database.getAllOrders();
      
      // Build map of existing claim data
      existingOrders.forEach(row => {
        const key = `${row.order_id}|${row.product_code}`;
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
        
        // Track max unique_id for new rows
        if (row.unique_id && parseInt(row.unique_id) > maxUniqueId) {
          maxUniqueId = parseInt(row.unique_id);
        }
      });
    } catch (e) {
      this.logApiActivity({ type: 'mysql-read-error', error: e.message });
    }

    // Flatten Shipway orders to one row per product, preserving existing claim data
    const flatOrders = [];
    let uniqueIdCounter = maxUniqueId + 1;
    
    for (const order of shipwayOrders) {
      if (!Array.isArray(order.products)) continue;
      
      // Extract order-level financial information and convert to number
      const orderTotal = parseFloat(order.order_total) || 0;
      
      // NEW LOGIC: Determine payment type and is_partial_paid based on payment_id and order_tags
      const paymentId = order.payment_id ? parseInt(order.payment_id) : null;
      const orderTags = Array.isArray(order.order_tags) ? order.order_tags : [];
      const hasPPCODTag = orderTags.includes('PPCOD');
      
      let paymentType = 'P'; // Default to prepaid
      let isPartialPaid = false;
      
      if (paymentId === 6) {
        // COD payment
        paymentType = 'C';
        if (hasPPCODTag) {
          // CASE 1: COD with partial prepayment (PPCOD)
          isPartialPaid = true;
        } else {
          // CASE 2: Pure COD (no prepayment)
          isPartialPaid = false;
        }
      } else if (paymentId === 12) {
        // CASE 3: Fully prepaid
        paymentType = 'P';
        isPartialPaid = false;
      }
      
      // Calculate total prepaid amount for the entire order based on payment type and is_partial_paid
      let totalPrepaidAmount = 0;
      if (paymentType === 'P') {
        // Fully prepaid: 100% of order total
        totalPrepaidAmount = parseFloat(orderTotal.toFixed(2));
      } else if (paymentType === 'C' && isPartialPaid) {
        // Partial prepaid COD: 10% of order total
        totalPrepaidAmount = parseFloat((orderTotal * 0.1).toFixed(2));
      } else {
        // Pure COD: 0% prepaid
        totalPrepaidAmount = 0;
      }
      
      // Calculate total selling price for all products in this order for ratio calculation
      const totalSellingPriceInOrder = order.products.reduce((sum, prod) => {
        return sum + (parseFloat(prod.price) || 0);
      }, 0);
      
      // Calculate ratio parts for each product
      let productRatios = [];
      if (totalSellingPriceInOrder > 0) {
        const prices = order.products.map(prod => parseFloat(prod.price) || 0);
        
        // Convert prices to integers to handle decimals (multiply by 100 for 2 decimal places)
        const intPrices = prices.map(price => Math.round(price * 100));
        
        // Find GCD of all prices to get simplest integer ratio
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const findGCD = (arr) => arr.reduce((acc, val) => gcd(acc, val));
        
        const pricesGCD = findGCD(intPrices.filter(p => p > 0));
        
        if (pricesGCD > 0) {
          productRatios = intPrices.map(price => Math.round(price / pricesGCD));
        } else {
          productRatios = prices.map(() => 1);
        }
      } else {
        productRatios = order.products.map(() => 1); // Equal ratio if no selling prices
      }
      
      // Calculate total of all ratios for this order
      const totalRatios = productRatios.reduce((sum, ratio) => sum + ratio, 0);
      
      for (let i = 0; i < order.products.length; i++) {
        const product = order.products[i];
        const key = `${order.order_id}|${product.product_code}`;
        const existingClaim = existingClaimData.get(key);
        
        // Get selling price from product data and convert to number
        const sellingPrice = parseFloat(product.price) || 0;
        
        // Get the ratio for this product
        const orderTotalRatio = productRatios[i] || 1;
        
        // Calculate the actual split amount for this product
        const orderTotalSplit = totalRatios > 0 
          ? parseFloat(((orderTotalRatio / totalRatios) * orderTotal).toFixed(2))
          : parseFloat((orderTotal / order.products.length).toFixed(2)); // Equal split if no ratios
        
        // Calculate the prepaid amount split for this product based on ratio
        const prepaidAmount = totalRatios > 0 
          ? parseFloat(((orderTotalRatio / totalRatios) * totalPrepaidAmount).toFixed(2))
          : parseFloat((totalPrepaidAmount / order.products.length).toFixed(2)); // Equal split if no ratios
        
        // NEW LOGIC: Calculate collectable amount based on payment type and is_partial_paid
        let collectableAmount = 0;
        if (paymentType === 'P') {
          // Fully prepaid: nothing to collect
          collectableAmount = 0;
        } else if (paymentType === 'C' && isPartialPaid) {
          // Partial prepaid COD: collect 90%
          collectableAmount = parseFloat((orderTotalSplit - prepaidAmount).toFixed(2));
        } else if (paymentType === 'C' && !isPartialPaid) {
          // Pure COD: collect 100%
          collectableAmount = parseFloat(orderTotalSplit.toFixed(2));
        }
        
        const orderRow = {
          id: `${order.order_id}_${product.product_code}_${Date.now()}`,
          unique_id: existingClaim ? existingClaim.unique_id : generateStableUniqueId(order.order_id, product.product_code, i),
          order_id: order.order_id,
          order_date: order.order_date, // Shipway sends IST time; MySQL connection is configured with IST timezone
          product_name: product.product,
          product_code: product.product_code,
          quantity: parseInt(product.amount) || 1,
          // Financial columns with updated logic
          selling_price: sellingPrice,
          order_total: orderTotal,
          payment_type: paymentType,
          is_partial_paid: isPartialPaid,
          prepaid_amount: prepaidAmount,
          order_total_ratio: orderTotalRatio,
          order_total_split: orderTotalSplit,
          collectable_amount: collectableAmount,
          // Add pincode from s_zipcode, preserve existing if available
          pincode: existingClaim ? existingClaim.pincode : (order.s_zipcode || ''),
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
          // Preserve custom columns or use empty defaults for new orders
          customer_name: existingClaim ? existingClaim.customer_name : '',
          // Add priority_carrier column (empty for new orders, preserve existing)
          priority_carrier: existingClaim ? existingClaim.priority_carrier : ''
        };
        
        flatOrders.push(orderRow);
      }
    }

    // Compare and update MySQL only if changed
    const existingKeySet = new Set(existingOrders.map(r => `${r.order_id}|${r.product_code}`));
    const newKeySet = new Set(flatOrders.map(r => `${r.order_id}|${r.product_code}`));
    let changed = false;
    let newOrdersCount = 0;
    let updatedOrdersCount = 0;
    
    // Check for new rows
    for (const row of flatOrders) {
      if (!existingKeySet.has(`${row.order_id}|${row.product_code}`)) {
        changed = true;
        newOrdersCount++;
      }
    }
    
    console.log(`📊 Sync Summary: ${newOrdersCount} new orders, ${existingOrders.length} existing orders`);
    
    // Note: We no longer check for removed rows to preserve historical data
    // Orders that are no longer in Shipway API will remain in our database
    
    // ALWAYS update is_in_new_order flags (regardless of other changes)
    try {
      // Step 1: Mark all existing orders as NOT in new order (is_in_new_order = 0)
      for (const existingOrder of existingOrders) {
        await database.updateOrder(existingOrder.unique_id, {
          is_in_new_order: false
        });
      }
      
      // Step 2: Insert or update orders from current Shipway API (is_in_new_order = 1)
      for (const orderRow of flatOrders) {
        const key = `${orderRow.order_id}|${orderRow.product_code}`;
        // Set is_in_new_order = 1 for all orders from current Shipway API
        orderRow.is_in_new_order = true;
        
        if (existingKeySet.has(key)) {
          // Check if existing order needs update by comparing key fields
          const existingOrder = existingOrders.find(o => `${o.order_id}|${o.product_code}` === key);
          if (existingOrder) {
            // Only update if there are actual changes to order data
            const hasDataChanges = (
              existingOrder.order_date !== orderRow.order_date ||
              existingOrder.product_name !== orderRow.product_name ||
              parseFloat(existingOrder.selling_price || 0) !== parseFloat(orderRow.selling_price || 0) ||
              parseFloat(existingOrder.order_total || 0) !== parseFloat(orderRow.order_total || 0) ||
              existingOrder.payment_type !== orderRow.payment_type ||
              Boolean(existingOrder.is_partial_paid) !== Boolean(orderRow.is_partial_paid) ||
              parseFloat(existingOrder.prepaid_amount || 0) !== parseFloat(orderRow.prepaid_amount || 0) ||
              parseFloat(existingOrder.order_total_ratio || 0) !== parseFloat(orderRow.order_total_ratio || 0) ||
              parseFloat(existingOrder.order_total_split || 0) !== parseFloat(orderRow.order_total_split || 0) ||
              parseFloat(existingOrder.collectable_amount || 0) !== parseFloat(orderRow.collectable_amount || 0) ||
              existingOrder.pincode !== orderRow.pincode
            );
            
            if (hasDataChanges) {
              // Only update if there are actual data changes
              await database.updateOrder(existingOrder.unique_id, {
                order_date: orderRow.order_date,
                product_name: orderRow.product_name,
                selling_price: orderRow.selling_price,
                order_total: orderRow.order_total,
                payment_type: orderRow.payment_type,
                is_partial_paid: orderRow.is_partial_paid,
                prepaid_amount: orderRow.prepaid_amount,
                order_total_ratio: orderRow.order_total_ratio,
                order_total_split: orderRow.order_total_split,
                collectable_amount: orderRow.collectable_amount,
                pincode: orderRow.pincode,
                is_in_new_order: true
              });
              updatedOrdersCount++;
              changed = true;
              console.log(`🔄 Updated existing order: ${orderRow.order_id}|${orderRow.product_code}`);
            } else {
              // Just update the is_in_new_order flag without changing other data
              await database.updateOrder(existingOrder.unique_id, {
                is_in_new_order: true
              });
              console.log(`✅ Preserved existing order: ${orderRow.order_id}|${orderRow.product_code}`);
            }
          }
        } else {
          // Insert new order with error handling for potential unique_id collision
          try {
            await database.createOrder(orderRow);
            newOrdersCount++;
            changed = true;
            console.log(`➕ Added new order: ${orderRow.order_id}|${orderRow.product_code}`);
          } catch (insertError) {
            // Handle any insertion errors gracefully
            if (insertError.message && insertError.message.includes('ER_DUP_ENTRY')) {
              console.error(`❌ COLLISION DETECTED: Duplicate unique_id for ${orderRow.order_id}|${orderRow.product_code}`);
              console.error(`   unique_id: ${orderRow.unique_id}`);
              console.error(`   Error: ${insertError.message}`);
              this.logApiActivity({
                type: 'unique-id-collision',
                orderId: orderRow.order_id,
                productCode: orderRow.product_code,
                uniqueId: orderRow.unique_id,
                error: insertError.message
              });
            } else {
              // Log other database errors but continue processing
              console.error(`❌ Error inserting order ${orderRow.order_id}|${orderRow.product_code}:`, insertError.message);
              this.logApiActivity({
                type: 'order-insert-error',
                orderId: orderRow.order_id,
                productCode: orderRow.product_code,
                uniqueId: orderRow.unique_id,
                error: insertError.message
              });
            }
            // Continue processing other orders (skip this one)
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

      // Only update other data if there were actual changes to orders
      if (changed || existingOrders.length === 0) {
        this.logApiActivity({ 
          type: 'mysql-write-with-new-columns', 
          rows: flatOrders.length, 
          preservedClaims: existingClaimData.size,
          newColumns: ['quantity', 'selling_price', 'order_total', 'payment_type', 'is_partial_paid', 'prepaid_amount', 'order_total_ratio', 'order_total_split', 'collectable_amount', 'customer_name', 'priority_carrier', 'pincode', 'is_in_new_order']
        });

        // Automatically enhance orders with customer names and product images
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

        // Automatically sync carriers from Shipway API
        try {
          const shipwayCarrierService = require('./shipwayCarrierService');
          const carrierResult = await shipwayCarrierService.syncCarriersToDatabase();
          this.logApiActivity({ 
            type: 'carrier-sync', 
            success: carrierResult.success,
            carrierCount: carrierResult.carrierCount,
            message: carrierResult.message
          });
        } catch (carrierError) {
          this.logApiActivity({ 
            type: 'carrier-sync-error', 
            error: carrierError.message 
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

  logApiActivity(activity) {
    const logPath = path.join(__dirname, '../logs/api.log');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${JSON.stringify(activity)}\n`;
    fs.appendFile(logPath, logEntry, err => {
      if (err) console.error('Failed to write API log:', err);
    });
  }

  /**
   * Fetch orders from Shipway API (for clone ID verification)
   * Uses pagination to get all orders
   * @returns {Promise<Array>} Array of orders from Shipway
   */
  async fetchOrdersFromShipway() {
    const url = `${this.baseURL}/getorders`;
    
    try {
      // Fetch all orders using Shipway's page-based pagination
      let allOrders = [];
      let page = 1;
      let hasMorePages = true;
      
      console.log('🔄 Starting paginated fetch from Shipway API (for clone verification)...');
      
      while (hasMorePages) {
        const currentParams = { 
          status: 'O',
          page: page
        };
        
        this.logApiActivity({ 
          type: 'shipway-fetch-orders', 
          url, 
          params: currentParams,
          page: page
        });
        
        console.log(`📄 Fetching page ${page} for clone verification...`);
        
        const response = await axios.get(url, {
          params: currentParams,
          headers: {
            'Authorization': this.basicAuthHeader,
            'Content-Type': 'application/json',
          },
          timeout: 10000, // Shorter timeout for clone verification
        });
        
        if (response.status !== 200 || !response.data) {
          throw new Error('Invalid response from Shipway API');
        }
        
        let currentPageOrders = [];
        if (Array.isArray(response.data)) {
          currentPageOrders = response.data;
        } else if (Array.isArray(response.data.orders)) {
          currentPageOrders = response.data.orders;
        } else if (typeof response.data === 'object' && Array.isArray(response.data.message) && response.data.success === 1) {
          currentPageOrders = response.data.message;
        } else if (typeof response.data === 'object' && response.data.order_id) {
          currentPageOrders = [response.data];
        } else {
          throw new Error('Unexpected Shipway API response format');
        }
        
        console.log(`  ✅ Page ${page}: ${currentPageOrders.length} orders`);
        
        // Add orders from this page to our collection
        allOrders = allOrders.concat(currentPageOrders);
        
        // If we got fewer than 100 orders, we've reached the last page
        if (currentPageOrders.length < 100) {
          hasMorePages = false;
          console.log(`  🏁 Last page reached (${currentPageOrders.length} < 100 orders)`);
        } else {
          console.log(`  ➡️ More pages available (${currentPageOrders.length} = 100 orders)`);
        }
        
        page++;
        
        // Safety check to prevent infinite loops (lower limit for clone verification)
        if (page > 10) {
          console.log('⚠️ Safety limit reached (10 pages), stopping pagination for clone verification');
          break;
        }
      }
      
      console.log(`🎉 Clone verification pagination complete! Total orders fetched: ${allOrders.length}`);
      
      return allOrders;
    } catch (error) {
      this.logApiActivity({ type: 'shipway-fetch-orders-error', error: error.message });
      throw new Error('Failed to fetch orders from Shipway API: ' + error.message);
    }
  }

  /**
   * Cancel shipment using Shipway API
   * @param {Array} awbNumbers - Array of AWB numbers to cancel
   * @returns {Object} Cancel result from Shipway API
   */
  async cancelShipment(awbNumbers) {
    try {
      if (!awbNumbers || !Array.isArray(awbNumbers) || awbNumbers.length === 0) {
        throw new Error('AWB numbers array is required and cannot be empty');
      }

      if (!this.basicAuthHeader) {
        throw new Error('Shipway API configuration error. Please contact administrator.');
      }

      const url = `${this.baseURL}/Cancel`;
      const requestBody = {
        awb_number: awbNumbers
      };

      this.logApiActivity({
        type: 'shipway-cancel-request',
        url,
        awbNumbers,
        headers: { Authorization: '***' },
      });

      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      this.logApiActivity({
        type: 'shipway-cancel-response',
        status: response.status,
        data: response.data,
      });

      // Check if response is successful
      if (response.status !== 200) {
        throw new Error(`Shipway API returned status ${response.status}`);
      }

      const data = response.data;

      // Validate response structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from Shipway API');
      }

      return {
        success: true,
        data: data,
        awbNumbers: awbNumbers
      };

    } catch (error) {
      this.logApiActivity({
        type: 'shipway-cancel-error',
        awbNumbers,
        error: error.message,
        stack: error.stack,
      });
      console.error('Error cancelling shipment for AWB numbers:', awbNumbers, 'from Shipway API:', error.message);
      
      // Handle specific error cases
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Shipway API. Please check your internet connection.');
      }
      
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Request to Shipway API timed out. Please try again.');
      }

      if (error.response) {
        // API returned an error response
        const status = error.response.status;
        if (status === 401) {
          throw new Error('Invalid Shipway API credentials. Please check your configuration.');
        } else if (status === 404) {
          throw new Error('AWB numbers not found in Shipway system.');
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else {
          throw new Error(`Shipway API error: ${error.response.data?.message || `Status ${status}`}`);
        }
      }

      // Re-throw the original error if it's already formatted
      if (error.message.includes('Shipway API') || 
          error.message.includes('Unable to connect') ||
          error.message.includes('timed out')) {
        throw error;
      }

      throw new Error('Failed to cancel shipment from Shipway API');
    }
  }
}

module.exports = new ShipwayService(); 
