require('dotenv').config();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const database = require('../config/database');

class CarrierServiceabilityService {
  constructor() {
    this.serviceabilityApiUrl = 'https://app.shipway.com/api/pincodeserviceable';
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
   * Check serviceability for a specific pincode
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
   * Get top 3 priority carriers for a specific order based on serviceability
   * @param {Object} order - Order object with pincode and payment_type
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
      
      // Check serviceability for the pincode
      console.log(`🔍 Checking serviceability for pincode: ${order.pincode} (store: ${order.account_code})`);
      const serviceableCarriers = await this.checkServiceability(order.pincode, order.account_code);
      
      if (serviceableCarriers.length === 0) {
        console.log(`⚠️ No serviceable carriers found for pincode ${order.pincode}`);
        return JSON.stringify([]);
      }
      
      console.log(`  - Found ${serviceableCarriers.length} serviceable carriers`);
      
      // Create a map of carrier data for quick lookup (store-specific)
      // Use composite key (carrier_id + account_code) to handle same carrier_id in different stores
      const carrierMap = new Map();
      storeCarriers.forEach(carrier => {
        const key = `${carrier.carrier_id}_${carrier.account_code}`;
        carrierMap.set(key, carrier);
        // Also set by carrier_id only for backward compatibility, but prefer store-specific
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
      // Only serviceable carriers are considered here (already filtered by checkServiceability)
      const validCarriers = matchingCarriers
        .map(carrier => {
          // Try to find carrier in store-specific carriers
          const storeCarrier = storeCarriers.find(sc => 
            String(sc.carrier_id) === String(carrier.carrier_id)
          );
          
          if (!storeCarrier) {
            return null; // Carrier not configured for this store
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
      // This automatically skips non-serviceable carriers and picks the next available ones
      const top3Carriers = validCarriers
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 3)
        .map(carrier => carrier.carrier_id);
      
      console.log(`✅ Top 3 carriers selected for store ${order.account_code}: ${JSON.stringify(top3Carriers)}`);
      top3Carriers.forEach((carrierId, index) => {
        const carrier = validCarriers.find(c => c.carrier_id === carrierId);
        console.log(`  ${index + 1}. ${carrierId} - ${carrier.name} (Priority: ${carrier.priority}, Store: ${carrier.account_code})`);
      });
      
      // Log if we got fewer than 3 carriers
      if (top3Carriers.length < 3 && validCarriers.length >= 3) {
        console.log(`  ⚠️ Only ${top3Carriers.length} carriers selected (expected 3). This may be due to serviceability or payment type filtering.`);
      }
      
      return JSON.stringify(top3Carriers);
      
    } catch (error) {
      console.error('💥 GET TOP 3 CARRIERS ERROR:', error.message);
      throw error;
    }
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