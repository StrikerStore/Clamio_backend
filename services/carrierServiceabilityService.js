require('dotenv').config();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const database = require('../config/database');

class CarrierServiceabilityService {
  constructor() {
    this.serviceabilityApiUrl = 'https://app.shipway.com/api/pincodeserviceable';
    this.shiprocketServiceabilityApiUrl = 'https://apiv2.shiprocket.in/v1/external/courier/serviceability/';
    // Store credentials cache: account_code -> { auth_token, shipping_partner }
    this.storeCredentialsCache = new Map();
    // Store info cache: account_code -> store object
    this.storeInfoCache = new Map();
  }

  /**
   * Get store credentials for a given account_code
   * @param {string} accountCode - The account_code to get credentials for
   * @returns {string} The auth_token for the store
   */
  async getStoreCredentials(accountCode) {
    if (!accountCode) {
      throw new Error('account_code is required for checking serviceability');
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
   * Get store info (shipping_partner, auth_token, etc.) for a given account_code
   * @param {string} accountCode - The account_code
   * @returns {Object} Store info object
   */
  async getStoreInfo(accountCode) {
    if (!accountCode) {
      throw new Error('account_code is required');
    }

    // Check cache first
    if (this.storeInfoCache.has(accountCode)) {
      return this.storeInfoCache.get(accountCode);
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

    // Cache the store info
    this.storeInfoCache.set(accountCode, store);
    
    return store;
  }

  /**
   * Check serviceability for Shiprocket using their API
   * @param {string} pickupPincode - Pickup/vendor pincode
   * @param {string} deliveryPincode - Delivery/customer pincode
   * @param {string} partnerOrderId - Shiprocket order ID (partner_order_id from orders table, which contains order.id)
   * @param {string} accountCode - The account_code for the store
   * @param {number} cod - 1 for COD orders, 0 for Prepaid orders
   * @returns {Promise<Array>} Array of available courier companies from Shiprocket
   */
  async checkShiprocketServiceability(pickupPincode, deliveryPincode, partnerOrderId, accountCode, cod = 0) {
    try {
      console.log(`🔵 SHIPROCKET SERVICEABILITY: Checking for pickup=${pickupPincode}, delivery=${deliveryPincode}, order=${partnerOrderId}, cod=${cod} (store: ${accountCode})...`);
      
      const store = await this.getStoreInfo(accountCode);
      
      if (!store.auth_token) {
        throw new Error(`Store auth_token not found for account_code: ${accountCode}`);
      }

      const response = await axios.get(this.shiprocketServiceabilityApiUrl, {
        params: {
          pickup_postcode: pickupPincode,
          delivery_postcode: deliveryPincode,
          order_id: partnerOrderId,
          cod: cod
        },
        headers: {
          'Authorization': store.auth_token, // Bearer token
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      console.log('✅ SHIPROCKET SERVICEABILITY: API response received');
      console.log('  - Status:', response.status);

      if (response.status !== 200 || !response.data) {
        throw new Error('Invalid response from Shiprocket serviceability API');
      }

      const availableCouriers = response.data?.data?.available_courier_companies || [];
      console.log(`  - Available courier companies: ${availableCouriers.length}`);

      return availableCouriers;
    } catch (error) {
      console.error('💥 SHIPROCKET SERVICEABILITY: Error:', error.message);
      
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', JSON.stringify(error.response.data));
        
        if (error.response.status === 401) {
          throw new Error('Shiprocket authentication failed. Please check your store credentials.');
        } else if (error.response.status === 422) {
          throw new Error('Invalid parameters for Shiprocket serviceability check.');
        }
      }
      
      throw new Error(`Failed to check Shiprocket serviceability: ${error.message}`);
    }
  }

  /**
   * Check serviceability for a specific pincode (Shipway)
   * @param {string} pincode - The pincode to check
   * @param {string} accountCode - The account_code for the store (REQUIRED)
   * @returns {Promise<Array>} Array of serviceable carriers
   */
  async checkServiceability(pincode, accountCode) {
    try {
      if (!accountCode) {
        throw new Error('account_code is required for checking serviceability');
      }

      console.log(`🔵 CARRIER SERVICEABILITY: Checking serviceability for pincode ${pincode} (store: ${accountCode})...`);
      
      // Get store-specific credentials
      const basicAuthHeader = await this.getStoreCredentials(accountCode);
      
      const response = await axios.get(`${this.serviceabilityApiUrl}?pincode=${pincode}`, {
        timeout: 30000, // 30 seconds timeout
        headers: {
          'Authorization': basicAuthHeader,
          'Content-Type': 'application/json',
          'User-Agent': 'Clamio-Carrier-Service/1.0'
        }
      });

      console.log('✅ CARRIER SERVICEABILITY: API response received');
      console.log('  - Status:', response.status);
      console.log('  - Success:', response.data.success);

      if (response.data.success !== 1) {
        throw new Error(`Serviceability check failed: ${response.data.error || 'Unknown error'}`);
      }

      const serviceableCarriers = response.data.message || [];
      console.log(`  - Serviceable carriers found: ${serviceableCarriers.length}`);

      return serviceableCarriers;
    } catch (error) {
      console.error('💥 CARRIER SERVICEABILITY: Error checking serviceability:', error.message);
      
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', error.response.data);
        
        if (error.response.status === 401) {
          throw new Error('Authentication failed. Please check your store credentials configuration.');
        } else if (error.response.status === 403) {
          throw new Error('Access forbidden. Please check your API permissions.');
        } else if (error.response.status === 404) {
          throw new Error('Serviceability API endpoint not found. Please verify the API URL.');
        }
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Shipway API. Please check your internet connection.');
      } else if (error.code === 'ETIMEDOUT') {
        throw new Error('Request to Shipway API timed out. Please try again.');
      }
      
      throw new Error(`Failed to check serviceability for pincode ${pincode}: ${error.message}`);
    }
  }

  /**
   * Read orders from MySQL database
   * @returns {Promise<Array>} Array of order data
   */
  async readOrdersFromDatabase() {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.log('📝 CARRIER SERVICEABILITY: MySQL connection not available');
        return [];
      }

      const orders = await database.getAllOrders();

      console.log('✅ CARRIER SERVICEABILITY: Orders loaded from MySQL');
      console.log('  - Total orders:', orders.length);

      return orders;
    } catch (error) {
      console.error('💥 CARRIER SERVICEABILITY: Error reading orders from MySQL:', error.message);
      throw new Error(`Failed to read orders from MySQL: ${error.message}`);
    }
  }

  /**
   * Read carriers from MySQL database
   * @returns {Promise<Array>} Array of carrier data
   */
  async readCarriersFromDatabase() {
    try {
      // Wait for MySQL initialization to complete
      const isAvailable = await database.waitForMySQLInitialization();
      if (!isAvailable) {
        throw new Error('MySQL connection not available. Please ensure MySQL is running and configured.');
      }

      const carriers = await database.getAllCarriers();
      
      console.log('✅ CARRIER SERVICEABILITY: Carriers loaded from MySQL');
      console.log('  - Total carriers:', carriers.length);

      return carriers;
    } catch (error) {
      console.error('💥 CARRIER SERVICEABILITY: Error reading carriers from MySQL:', error.message);
      throw new Error(`Failed to read carriers from database: ${error.message}`);
    }
  }


  /**
   * Find the highest priority carrier for a given payment type
   * @param {Array} serviceableCarriers - Array of serviceable carriers from API
   * @param {Array} carrierData - Array of carrier data from database
   * @param {string} paymentType - Payment type to match
   * @returns {Object|null} Carrier with highest priority or null if not found
   */
  findHighestPriorityCarrier(serviceableCarriers, carrierData, paymentType) {
    try {
      console.log(`🔍 CARRIER SERVICEABILITY: Finding highest priority carrier for payment type: ${paymentType}`);
      
      // Create a map of carrier data for quick lookup
      const carrierMap = new Map(carrierData.map(carrier => [carrier.carrier_id, carrier]));
      
      // Filter serviceable carriers by payment type
      const matchingCarriers = serviceableCarriers.filter(carrier => 
        carrier.payment_type === paymentType
      );
      
      console.log(`  - Serviceable carriers with payment type ${paymentType}: ${matchingCarriers.length}`);
      
      if (matchingCarriers.length === 0) {
        console.log(`  - No carriers found with payment type ${paymentType}`);
        return null;
      }
      
      // Find carriers that exist in our carrier data
      const validCarriers = matchingCarriers.filter(carrier => 
        carrierMap.has(carrier.carrier_id)
      );
      
      console.log(`  - Valid carriers in our data: ${validCarriers.length}`);
      
      if (validCarriers.length === 0) {
        console.log(`  - No valid carriers found in our data for payment type ${paymentType}`);
        return null;
      }
      
      // Find the carrier with the highest priority (lowest priority number) and active status
      let highestPriorityCarrier = null;
      let highestPriority = -1;
      
      validCarriers.forEach(carrier => {
        const carrierInfo = carrierMap.get(carrier.carrier_id);
        const statusLower = String(carrierInfo.status || '').trim().toLowerCase();
        if (statusLower !== 'active') {
          return; // skip inactive carriers
        }
        const priority = parseInt(carrierInfo.priority) || 0;
        
        if (highestPriority === -1 || priority < highestPriority) {
          highestPriority = priority;
          highestPriorityCarrier = {
            carrier_id: carrier.carrier_id,
            name: carrier.name,
            payment_type: carrier.payment_type,
            priority: priority
          };
        }
      });
      
      console.log(`  - Selected carrier: ${highestPriorityCarrier.carrier_id} with priority ${highestPriorityCarrier.priority}`);
      
      return highestPriorityCarrier;
    } catch (error) {
      console.error('💥 CARRIER SERVICEABILITY: Error finding highest priority carrier:', error.message);
      throw new Error(`Failed to find highest priority carrier: ${error.message}`);
    }
  }

  /**
   * Save orders back to MySQL database with priority_carrier column
   * @param {Array} orders - Array of order data with priority_carrier column
   * @returns {Promise<Object>} Result object
   */
  async saveOrdersToDatabase(orders) {
    try {
      console.log('🔵 CARRIER SERVICEABILITY: Saving orders to MySQL...');
      
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        throw new Error('MySQL connection not available');
      }

      let updatedCount = 0;
      
      // Update each order in the database
      for (const order of orders) {
        if (order.unique_id && order.priority_carrier) {
          await database.updateOrder(order.unique_id, {
            priority_carrier: order.priority_carrier
          });
          updatedCount++;
        }
      }
      
      console.log('✅ CARRIER SERVICEABILITY: Orders saved to MySQL');
      console.log('  - Total orders updated:', updatedCount);

      return {
        success: true,
        message: `Successfully saved ${updatedCount} orders to MySQL with priority_carrier column`,
        orderCount: updatedCount
      };
    } catch (error) {
      console.error('💥 CARRIER SERVICEABILITY: Error saving to MySQL:', error.message);
      throw new Error(`Failed to save orders to MySQL: ${error.message}`);
    }
  }

  /**
   * Main function to assign priority carriers to all orders
   * @returns {Promise<Object>} Result of the operation
   */
  async assignPriorityCarriersToOrders() {
    try {
      console.log('🔵 CARRIER SERVICEABILITY: Starting priority carrier assignment...');
      
      // Read orders from MySQL and carriers from database
      const orders = await this.readOrdersFromDatabase();
      const carriers = await this.readCarriersFromDatabase();
      
      if (orders.length === 0) {
        throw new Error('No orders found in MySQL database');
      }
      
      if (carriers.length === 0) {
        throw new Error('No carriers found in database');
      }
      
      console.log(`📊 Processing ${orders.length} orders with ${carriers.length} carriers`);
      
      // Filter only claimed orders
      const claimedOrders = orders.filter(order => 
        order.status === 'claimed' && order.claimed_by && order.claimed_by.trim() !== ''
      );
      
      console.log(`📊 Total orders: ${orders.length}`);
      console.log(`📊 Claimed orders: ${claimedOrders.length}`);
      console.log(`📊 Unclaimed orders: ${orders.length - claimedOrders.length}`);
      
      if (claimedOrders.length === 0) {
        console.log('⚠️ No claimed orders found. No serviceability checks needed.');
        return {
          success: true,
          message: 'No claimed orders found. No carrier assignment needed.',
          orderCount: orders.length,
          summary: {
            totalOrders: orders.length,
            assignedCarriers: 0,
            skippedOrders: 0,
            successRate: '0.00%'
          }
        };
      }
      
      // Track unique pincodes per store (account_code) from claimed orders
      // Structure: Map<account_code, Map<pincode, serviceableCarriers[]>>
      const storePincodeServiceabilityMap = new Map();
      
      // Group orders by account_code and collect unique pincodes per store
      const ordersByStore = new Map();
      claimedOrders.forEach(order => {
        if (!order.account_code) {
          console.log(`⚠️ Order ${order.order_id}: Missing account_code, skipping serviceability check`);
          return;
        }
        
        if (!ordersByStore.has(order.account_code)) {
          ordersByStore.set(order.account_code, []);
        }
        ordersByStore.get(order.account_code).push(order);
      });
      
      console.log(`📊 Processing orders from ${ordersByStore.size} store(s)`);
      
      // Check serviceability for each unique pincode per store
      for (const [accountCode, storeOrders] of ordersByStore.entries()) {
        const uniquePincodes = new Set();
        storeOrders.forEach(order => {
          if (order.pincode) {
            uniquePincodes.add(order.pincode);
          }
        });
        
        console.log(`\n🔍 Store ${accountCode}: Checking serviceability for ${uniquePincodes.size} unique pincode(s)`);
        
        const pincodeServiceabilityMap = new Map();
        
        for (const pincode of uniquePincodes) {
          try {
            console.log(`  🔍 Checking serviceability for pincode: ${pincode} (store: ${accountCode})`);
            const serviceableCarriers = await this.checkServiceability(pincode, accountCode);
            pincodeServiceabilityMap.set(pincode, serviceableCarriers);
            
            console.log(`  - Serviceable carriers: ${serviceableCarriers.length}`);
            serviceableCarriers.forEach(carrier => {
              console.log(`    * ${carrier.carrier_id} - ${carrier.name} (${carrier.payment_type})`);
            });
          } catch (error) {
            console.error(`  - Error checking serviceability for pincode ${pincode} (store: ${accountCode}):`, error.message);
            // Continue with other pincodes
            pincodeServiceabilityMap.set(pincode, []);
          }
        }
        
        storePincodeServiceabilityMap.set(accountCode, pincodeServiceabilityMap);
      }
      
      // Process each order and assign priority carrier
      let processedOrders = 0;
      let assignedCarriers = 0;
      let skippedOrders = 0;
      let unclaimedOrders = 0;
      
      const updatedOrders = orders.map(order => {
        try {
          // Check if order is claimed
          const isClaimed = order.status === 'claimed' && order.claimed_by && order.claimed_by.trim() !== '';
          
          if (!isClaimed) {
            // For unclaimed orders, preserve existing priority_carrier or leave empty
            unclaimedOrders++;
            return {
              ...order,
              priority_carrier: order.priority_carrier || ''
            };
          }
          
          // Process only claimed orders
          const pincode = order.pincode;
          const paymentType = order.payment_type;
          const accountCode = order.account_code;
          
          if (!pincode || !paymentType) {
            console.log(`⚠️ Order ${order.order_id}: Missing pincode or payment_type`);
            skippedOrders++;
            return {
              ...order,
              priority_carrier: ''
            };
          }
          
          if (!accountCode) {
            console.log(`⚠️ Order ${order.order_id}: Missing account_code, cannot check serviceability`);
            skippedOrders++;
            return {
              ...order,
              priority_carrier: ''
            };
          }
          
          // Get serviceability data for this store's pincode
          const storeServiceabilityMap = storePincodeServiceabilityMap.get(accountCode);
          const serviceableCarriers = storeServiceabilityMap ? (storeServiceabilityMap.get(pincode) || []) : [];
          
          if (serviceableCarriers.length === 0) {
            console.log(`⚠️ Order ${order.order_id}: No serviceable carriers for pincode ${pincode}`);
            skippedOrders++;
            return {
              ...order,
              priority_carrier: ''
            };
          }
          
          const selectedCarrier = this.findHighestPriorityCarrier(
            serviceableCarriers, 
            carriers, 
            paymentType
          );
          
          if (selectedCarrier) {
            console.log(`✅ Order ${order.order_id}: Assigned carrier ${selectedCarrier.carrier_id} (priority ${selectedCarrier.priority})`);
            assignedCarriers++;
            return {
              ...order,
              priority_carrier: selectedCarrier.carrier_id
            };
          } else {
            console.log(`⚠️ Order ${order.order_id}: No suitable carrier found for payment type ${paymentType}`);
            skippedOrders++;
            return {
              ...order,
              priority_carrier: ''
            };
          }
        } catch (error) {
          console.error(`💥 Error processing order ${order.order_id}:`, error.message);
          skippedOrders++;
          return {
            ...order,
            priority_carrier: ''
          };
        } finally {
          processedOrders++;
        }
      });
      
      // Save updated orders to MySQL
      const result = await this.saveOrdersToDatabase(updatedOrders);
      
      console.log('\n🎉 CARRIER SERVICEABILITY: Priority carrier assignment completed!');
      console.log(`📊 Summary:`);
      console.log(`  - Total orders: ${processedOrders}`);
      console.log(`  - Claimed orders processed: ${claimedOrders.length}`);
      console.log(`  - Unclaimed orders preserved: ${unclaimedOrders}`);
      console.log(`  - Orders with assigned carriers: ${assignedCarriers}`);
      console.log(`  - Orders skipped: ${skippedOrders}`);
      console.log(`  - Success rate: ${((assignedCarriers / claimedOrders.length) * 100).toFixed(2)}%`);
      
      return {
        ...result,
        summary: {
          totalOrders: processedOrders,
          claimedOrders: claimedOrders.length,
          unclaimedOrders,
          assignedCarriers,
          skippedOrders,
          successRate: ((assignedCarriers / claimedOrders.length) * 100).toFixed(2) + '%'
        }
      };
    } catch (error) {
      console.error('💥 CARRIER SERVICEABILITY: Error assigning priority carriers:', error.message);
      throw error;
    }
  }

  /**
   * Assign priority carrier to a single claimed order
   * @param {string} orderId - The order ID to assign carrier to
   * @returns {Promise<Object>} Result of the assignment
   */
  async assignPriorityCarrierToOrder(orderId) {
    try {
      console.log(`🔵 CARRIER SERVICEABILITY: Assigning priority carrier to order ${orderId}...`);
      
      // Read orders from MySQL and carriers from database
      const orders = await this.readOrdersFromDatabase();
      const carriers = await this.readCarriersFromDatabase();
      
      if (orders.length === 0) {
        throw new Error('No orders found in MySQL database');
      }
      
      if (carriers.length === 0) {
        throw new Error('No carriers found in database');
      }
      
      // Find the specific order
      const orderIndex = orders.findIndex(order => order.order_id === orderId);
      if (orderIndex === -1) {
        throw new Error(`Order ${orderId} not found`);
      }
      
      const order = orders[orderIndex];
      
      // Check if order is claimed
      if (!(order.status === 'claimed' && order.claimed_by && order.claimed_by.trim() !== '')) {
        throw new Error(`Order ${orderId} is not claimed`);
      }
      
      console.log(`📊 Processing claimed order: ${orderId}`);
      console.log(`  - Pincode: ${order.pincode}`);
      console.log(`  - Payment Type: ${order.payment_type}`);
      console.log(`  - Claimed by: ${order.claimed_by}`);
      
      // Check serviceability for this specific pincode
      const pincode = order.pincode;
      const paymentType = order.payment_type;
      const accountCode = order.account_code;
      
      if (!pincode || !paymentType) {
        throw new Error(`Order ${orderId}: Missing pincode or payment_type`);
      }
      
      if (!accountCode) {
        throw new Error(`Order ${orderId}: Missing account_code, cannot check serviceability`);
      }
      
      console.log(`🔍 Checking serviceability for pincode: ${pincode} (store: ${accountCode})`);
      const serviceableCarriers = await this.checkServiceability(pincode, accountCode);
      
      if (serviceableCarriers.length === 0) {
        throw new Error(`Order ${orderId}: No serviceable carriers for pincode ${pincode}`);
      }
      
      // Find the highest priority carrier
      const selectedCarrier = this.findHighestPriorityCarrier(
        serviceableCarriers, 
        carriers, 
        paymentType
      );
      
      if (!selectedCarrier) {
        throw new Error(`Order ${orderId}: No suitable carrier found for payment type ${paymentType}`);
      }
      
      // Update the order with the selected carrier
      orders[orderIndex].priority_carrier = selectedCarrier.carrier_id;
      
      // Save updated orders to MySQL
      const result = await this.saveOrdersToDatabase(orders);
      
      console.log(`✅ Order ${orderId}: Assigned carrier ${selectedCarrier.carrier_id} (priority ${selectedCarrier.priority})`);
      
      return {
        success: true,
        message: `Successfully assigned carrier ${selectedCarrier.carrier_id} to order ${orderId}`,
        data: {
          order_id: orderId,
          carrier_id: selectedCarrier.carrier_id,
          carrier_name: selectedCarrier.name,
          priority: selectedCarrier.priority,
          pincode: pincode,
          payment_type: paymentType
        }
      };
      
    } catch (error) {
      console.error('💥 CARRIER SERVICEABILITY: Error assigning priority carrier to order:', error.message);
      throw error;
    }
  }

  /**
   * Assign priority carrier to a single order using in-memory data
   * @param {Object} order - The order object with updated status
   * @returns {Promise<Object>} Result of the assignment
   */
  async assignPriorityCarrierToOrderInMemory(order) {
    try {
      console.log(`🔵 CARRIER SERVICEABILITY: Assigning priority carrier to order ${order.order_id} (in-memory)...`);
      
      // Read carriers from database
      const carriers = await this.readCarriersFromDatabase();
      
      if (carriers.length === 0) {
        throw new Error('No carriers found in database');
      }
      
      // Check if order is claimed
      if (!(order.status === 'claimed' && order.claimed_by && order.claimed_by.trim() !== '')) {
        throw new Error(`Order ${order.order_id} is not claimed`);
      }
      
      console.log(`📊 Processing claimed order: ${order.order_id}`);
      console.log(`  - Pincode: ${order.pincode}`);
      console.log(`  - Payment Type: ${order.payment_type}`);
      console.log(`  - Claimed by: ${order.claimed_by}`);
      
      // Check serviceability for this specific pincode
      const pincode = order.pincode;
      const paymentType = order.payment_type;
      const accountCode = order.account_code;
      
      if (!pincode || !paymentType) {
        throw new Error(`Order ${order.order_id}: Missing pincode or payment_type`);
      }
      
      if (!accountCode) {
        throw new Error(`Order ${order.order_id}: Missing account_code, cannot check serviceability`);
      }
      
      console.log(`🔍 Checking serviceability for pincode: ${pincode} (store: ${accountCode})`);
      const serviceableCarriers = await this.checkServiceability(pincode, accountCode);
      
      if (serviceableCarriers.length === 0) {
        throw new Error(`Order ${order.order_id}: No serviceable carriers for pincode ${pincode}`);
      }
      
      // Find the highest priority carrier
      const selectedCarrier = this.findHighestPriorityCarrier(
        serviceableCarriers, 
        carriers, 
        paymentType
      );
      
      if (!selectedCarrier) {
        throw new Error(`Order ${order.order_id}: No suitable carrier found for payment type ${paymentType}`);
      }
      
      console.log(`✅ Order ${order.order_id}: Assigned carrier ${selectedCarrier.carrier_id} (priority ${selectedCarrier.priority})`);
      
      return {
        success: true,
        message: `Successfully assigned carrier ${selectedCarrier.carrier_id} to order ${order.order_id}`,
        data: {
          order_id: order.order_id,
          carrier_id: selectedCarrier.carrier_id,
          carrier_name: selectedCarrier.name,
          priority: selectedCarrier.priority,
          pincode: pincode,
          payment_type: paymentType
        }
      };
      
    } catch (error) {
      console.error('💥 CARRIER SERVICEABILITY: Error assigning priority carrier to order (in-memory):', error.message);
      throw error;
    }
  }

  /**
   * Get top 3 priority carriers for a specific order based on serviceability.
   * Automatically detects shipping partner (Shipway or Shiprocket) and uses the appropriate API.
   * For Shiprocket COD orders (payment_type = C), only couriers with cod = 1 are considered.
   * @param {Object} order - Order object with pincode, payment_type, account_code, claimed_by, partner_order_id
   * @returns {Promise<string>} JSON string of top 3 carrier IDs: "[12121, 23232, 34333]"
   */
  async getTop3PriorityCarriers(order) {
    try {
      console.log(`🔵 GET TOP 3 CARRIERS: Starting for order ${order.order_id || order.unique_id}...`);
      console.log(`  - Pincode: ${order.pincode}`);
      console.log(`  - Payment Type: ${order.payment_type}`);
      console.log(`  - Account Code (Store): ${order.account_code || 'NOT SET'}`);
      
      // Validate input
      if (!order.pincode || !order.payment_type) {
        throw new Error('Order must have pincode and payment_type');
      }
      
      // Validate account_code is present
      if (!order.account_code) {
        throw new Error('Order must have account_code (store) to determine carrier priorities');
      }
      
      // Determine the shipping partner for this store
      const store = await this.getStoreInfo(order.account_code);
      const shippingPartner = (store.shipping_partner || 'Shipway').toLowerCase();
      console.log(`  - Shipping Partner: ${shippingPartner}`);
      
      if (shippingPartner === 'shiprocket') {
        return await this._getTop3ShiprocketCarriers(order, store);
      } else {
        return await this._getTop3ShipwayCarriers(order);
      }
      
    } catch (error) {
      console.error('💥 GET TOP 3 CARRIERS ERROR:', error.message);
      throw error;
    }
  }

  /**
   * Get top 3 priority carriers for Shiprocket orders.
   * For COD orders (payment_type = C), only couriers with cod = 1 are considered.
   * @param {Object} order - Order object
   * @param {Object} store - Store info object
   * @returns {Promise<string>} JSON string of top 3 carrier IDs
   */
  async _getTop3ShiprocketCarriers(order, store) {
    console.log(`🚀 SHIPROCKET: Getting top 3 carriers for order ${order.order_id}...`);
    
    // Get vendor's pincode (pickup_postcode) from users table using claimed_by
    if (!order.claimed_by) {
      throw new Error('Order must have claimed_by (vendor) to check Shiprocket serviceability');
    }
    
    const vendor = await database.getUserByWarehouseId(order.claimed_by);
    if (!vendor) {
      throw new Error(`Vendor not found for warehouseId: ${order.claimed_by}`);
    }
    
    const pickupPincode = vendor.pincode;
    if (!pickupPincode) {
      throw new Error(`Vendor ${order.claimed_by} does not have a pincode configured`);
    }
    
    const deliveryPincode = order.pincode;
    const partnerOrderId = order.partner_order_id;
    
    if (!partnerOrderId) {
      throw new Error('Order must have partner_order_id for Shiprocket serviceability check');
    }
    
    // Determine cod value from payment_type: C (COD) → 1, P (Prepaid) → 0
    const codValue = order.payment_type === 'C' ? 1 : 0;
    
    console.log(`  - Pickup Pincode (Vendor): ${pickupPincode}`);
    console.log(`  - Delivery Pincode (Customer): ${deliveryPincode}`);
    console.log(`  - Partner Order ID (order.id): ${partnerOrderId}`);
    console.log(`  - COD: ${codValue} (payment_type: ${order.payment_type})`);
    
    // Get carriers from database - filter by store (account_code)
    const allCarriers = await this.readCarriersFromDatabase();
    const storeCarriers = allCarriers.filter(carrier => 
      String(carrier.account_code) === String(order.account_code)
    );
    
    console.log(`  - Total carriers in database: ${allCarriers.length}`);
    console.log(`  - Carriers for store ${order.account_code}: ${storeCarriers.length}`);
    
    if (storeCarriers.length === 0) {
      throw new Error(`No carriers found for store ${order.account_code}`);
    }
    
    // Call Shiprocket serviceability API with cod parameter
    // Note: API expects order_id (which is order.id, stored in partner_order_id)
    const availableCouriers = await this.checkShiprocketServiceability(
      pickupPincode, deliveryPincode, partnerOrderId, order.account_code, codValue
    );
    
    if (availableCouriers.length === 0) {
      console.log(`⚠️ No serviceable couriers found from Shiprocket API`);
      return JSON.stringify([]);
    }
    
    console.log(`  - Available couriers from Shiprocket API: ${availableCouriers.length}`);
    
    // For COD orders (payment_type = C), filter couriers that support COD (cod = 1)
    let filteredCouriers = availableCouriers;
    if (order.payment_type === 'C') {
      filteredCouriers = availableCouriers.filter(courier => courier.cod === 1);
      console.log(`  - COD order: Filtered to couriers with cod=1: ${filteredCouriers.length} (out of ${availableCouriers.length})`);
    } else {
      console.log(`  - Prepaid order: Using all ${availableCouriers.length} available couriers`);
    }
    
    if (filteredCouriers.length === 0) {
      console.log(`⚠️ No couriers found${order.payment_type === 'C' ? ' with COD support' : ''} for this delivery`);
      return JSON.stringify([]);
    }
    
    // Build a set of courier_company_ids from Shiprocket API response
    const serviceableCourierIds = new Set(filteredCouriers.map(c => String(c.courier_company_id)));
    
    // Match with our store carriers by carrier_id and check active status
    const validCarriers = storeCarriers
      .filter(sc => {
        const isServiceable = serviceableCourierIds.has(String(sc.carrier_id));
        const isActive = String(sc.status || '').trim().toLowerCase() === 'active';
        return isServiceable && isActive;
      })
      .map(sc => {
        // Find the matching courier from API to get its name
        const apiCourier = filteredCouriers.find(c => String(c.courier_company_id) === String(sc.carrier_id));
        return {
          carrier_id: sc.carrier_id,
          name: apiCourier ? apiCourier.courier_name : sc.carrier_name,
          priority: parseInt(sc.priority) || 999,
          status: String(sc.status || '').trim().toLowerCase(),
          account_code: sc.account_code,
          cod: apiCourier ? apiCourier.cod : 0
        };
      });
    
    console.log(`  - Valid active carriers for store ${order.account_code}: ${validCarriers.length}`);
    
    // Log which store carriers are NOT serviceable (for debugging)
    const nonServiceableStoreCarriers = storeCarriers
      .filter(sc => !serviceableCourierIds.has(String(sc.carrier_id)))
      .sort((a, b) => (parseInt(a.priority) || 999) - (parseInt(b.priority) || 999));
    
    if (nonServiceableStoreCarriers.length > 0) {
      console.log(`  - Store carriers NOT serviceable: ${nonServiceableStoreCarriers.map(c => `${c.carrier_id} (Priority ${c.priority})`).join(', ')}`);
    }
    
    if (validCarriers.length === 0) {
      console.log(`⚠️ No valid active carriers found for store ${order.account_code}`);
      return JSON.stringify([]);
    }
    
    // Sort by priority (ascending: 1, 2, 3...) and take top 3
    const top3Carriers = validCarriers
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 3)
      .map(carrier => carrier.carrier_id);
    
    console.log(`✅ Top 3 Shiprocket carriers selected for store ${order.account_code}: ${JSON.stringify(top3Carriers)}`);
    top3Carriers.forEach((carrierId, index) => {
      const carrier = validCarriers.find(c => c.carrier_id === carrierId);
      console.log(`  ${index + 1}. ${carrierId} - ${carrier.name} (Priority: ${carrier.priority}, COD: ${carrier.cod})`);
    });
    
    if (top3Carriers.length < 3) {
      console.log(`  ⚠️ Only ${top3Carriers.length} carriers selected (less than 3).`);
    }
    
    return JSON.stringify(top3Carriers);
  }

  /**
   * Get top 3 priority carriers for Shipway orders (existing logic).
   * @param {Object} order - Order object
   * @returns {Promise<string>} JSON string of top 3 carrier IDs
   */
  async _getTop3ShipwayCarriers(order) {
    console.log(`📦 SHIPWAY: Getting top 3 carriers for order ${order.order_id}...`);
    
    // Get carriers from database - filter by store (account_code)
    const allCarriers = await this.readCarriersFromDatabase();
    
    // Filter carriers by the order's store (account_code)
    const storeCarriers = allCarriers.filter(carrier => 
      String(carrier.account_code) === String(order.account_code)
    );
    
    console.log(`  - Total carriers in database: ${allCarriers.length}`);
    console.log(`  - Carriers for store ${order.account_code}: ${storeCarriers.length}`);
    
    if (storeCarriers.length === 0) {
      throw new Error(`No carriers found for store ${order.account_code}`);
    }
    
    // Check serviceability for the pincode (Shipway API)
    console.log(`🔍 Checking serviceability for pincode: ${order.pincode} (store: ${order.account_code})`);
    const serviceableCarriers = await this.checkServiceability(order.pincode, order.account_code);
    
    if (serviceableCarriers.length === 0) {
      console.log(`⚠️ No serviceable carriers found for pincode ${order.pincode}`);
      return JSON.stringify([]);
    }
    
    console.log(`  - Found ${serviceableCarriers.length} serviceable carriers`);
    
    // Create a map of carrier data for quick lookup (store-specific)
    const carrierMap = new Map();
    storeCarriers.forEach(carrier => {
      const key = `${carrier.carrier_id}_${carrier.account_code}`;
      carrierMap.set(key, carrier);
      if (!carrierMap.has(carrier.carrier_id)) {
        carrierMap.set(carrier.carrier_id, carrier);
      }
    });
    
    // Filter serviceable carriers by payment type
    const matchingCarriers = serviceableCarriers.filter(carrier => 
      carrier.payment_type === order.payment_type
    );
    
    console.log(`  - Carriers matching payment type ${order.payment_type}: ${matchingCarriers.length}`);
    
    if (matchingCarriers.length === 0) {
      console.log(`⚠️ No carriers found with payment type ${order.payment_type}`);
      return JSON.stringify([]);
    }
    
    // Find carriers that exist in our carrier data for THIS STORE and are active
    const validCarriers = matchingCarriers
      .map(carrier => {
        const storeCarrier = storeCarriers.find(sc => 
          String(sc.carrier_id) === String(carrier.carrier_id)
        );
        
        if (!storeCarrier) {
          return null;
        }
        
        return {
          carrier_id: carrier.carrier_id,
          name: carrier.name,
          payment_type: carrier.payment_type,
          priority: parseInt(storeCarrier.priority) || 999,
          status: String(storeCarrier.status || '').trim().toLowerCase(),
          account_code: storeCarrier.account_code
        };
      })
      .filter(carrier => carrier !== null && carrier.status === 'active');
    
    console.log(`  - Valid active carriers for store ${order.account_code}: ${validCarriers.length}`);
    
    // Log which store carriers are NOT serviceable (for debugging)
    const serviceableCarrierIds = new Set(serviceableCarriers.map(c => String(c.carrier_id)));
    const nonServiceableStoreCarriers = storeCarriers
      .filter(sc => !serviceableCarrierIds.has(String(sc.carrier_id)))
      .sort((a, b) => (parseInt(a.priority) || 999) - (parseInt(b.priority) || 999));
    
    if (nonServiceableStoreCarriers.length > 0) {
      console.log(`  - Store carriers NOT serviceable for pincode ${order.pincode}: ${nonServiceableStoreCarriers.map(c => `${c.carrier_id} (Priority ${c.priority})`).join(', ')}`);
    }
    
    if (validCarriers.length === 0) {
      console.log(`⚠️ No valid active carriers found for store ${order.account_code}`);
      return JSON.stringify([]);
    }
    
    // Sort by priority (ascending: 1, 2, 3...) and take top 3
    const top3Carriers = validCarriers
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 3)
      .map(carrier => carrier.carrier_id);
    
    console.log(`✅ Top 3 Shipway carriers selected for store ${order.account_code}: ${JSON.stringify(top3Carriers)}`);
    top3Carriers.forEach((carrierId, index) => {
      const carrier = validCarriers.find(c => c.carrier_id === carrierId);
      console.log(`  ${index + 1}. ${carrierId} - ${carrier.name} (Priority: ${carrier.priority}, Store: ${carrier.account_code})`);
    });
    
    if (top3Carriers.length < 3 && validCarriers.length >= 3) {
      console.log(`  ⚠️ Only ${top3Carriers.length} carriers selected (expected 3). This may be due to serviceability or payment type filtering.`);
    }
    
    return JSON.stringify(top3Carriers);
  }

  /**
   * Get statistics about the assignment process
   * @returns {Promise<Object>} Statistics about orders and carriers
   */
  async getAssignmentStatistics() {
    try {
      const orders = await this.readOrdersFromDatabase();
      const carriers = await this.readCarriersFromDatabase();
      
      const claimedOrders = orders.filter(order => 
        order.status === 'claimed' && order.claimed_by && order.claimed_by.trim() !== ''
      );
      const unclaimedOrders = orders.filter(order => 
        !(order.status === 'claimed' && order.claimed_by && order.claimed_by.trim() !== '')
      );
      
      const ordersWithCarrier = orders.filter(order => order.priority_carrier && order.priority_carrier.trim() !== '');
      const ordersWithoutCarrier = orders.filter(order => !order.priority_carrier || order.priority_carrier.trim() === '');
      
      const uniquePincodes = new Set(orders.map(order => order.pincode).filter(Boolean));
      const uniquePaymentTypes = new Set(orders.map(order => order.payment_type).filter(Boolean));
      
      const carrierUsage = {};
      ordersWithCarrier.forEach(order => {
        const carrierId = order.priority_carrier;
        carrierUsage[carrierId] = (carrierUsage[carrierId] || 0) + 1;
      });
      
      return {
        success: true,
        orders: {
          total: orders.length,
          claimed: claimedOrders.length,
          unclaimed: unclaimedOrders.length,
          withCarrier: ordersWithCarrier.length,
          withoutCarrier: ordersWithoutCarrier.length,
          successRate: ((ordersWithCarrier.length / orders.length) * 100).toFixed(2) + '%'
        },
        carriers: {
          total: carriers.length,
          used: Object.keys(carrierUsage).length,
          usage: carrierUsage
        },
        pincodes: {
          total: uniquePincodes.size,
          list: Array.from(uniquePincodes)
        },
        paymentTypes: {
          total: uniquePaymentTypes.size,
          list: Array.from(uniquePaymentTypes)
        }
      };
    } catch (error) {
      console.error('Error getting assignment statistics:', error);
      throw error;
    }
  }
}

module.exports = new CarrierServiceabilityService(); 