const fs = require('fs');
const path = require('path');
const database = require('../config/database');

class OrderEnhancementService {
  constructor() {
    this.rawShipwayPath = path.join(__dirname, '../data/raw_shipway_orders.json');
  }

  /**
   * Automatically enhance orders in MySQL with customer_name and product_image columns
   * This is called after orders are synced to MySQL by shipwayService
   */
  async enhanceOrdersMySQL() {
    console.log('🔧 OrderEnhancementService: Starting automatic MySQL enhancement...');
    
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      if (!database.isMySQLAvailable()) {
        console.log('❌ OrderEnhancementService: MySQL connection not available');
        return { success: false, message: 'MySQL connection not available' };
      }

      // Get all orders from MySQL
      const orders = await database.getAllOrders();
      console.log(`📊 OrderEnhancementService: Processing ${orders.length} orders from MySQL`);

      if (orders.length === 0) {
        console.log('ℹ️  OrderEnhancementService: No orders found in MySQL, skipping enhancement');
        return { success: true, message: 'No orders to enhance' };
      }

      // Check if enhancement is needed by checking ALL orders, not just the first one
      const needsCustomerNames = orders.some(order => !order.customer_name);

      if (!needsCustomerNames) {
        console.log('✅ OrderEnhancementService: All orders already enhanced, skipping');
        return { success: true, message: 'All orders already enhanced' };
      }

      console.log(`🔍 OrderEnhancementService: Enhancement needed - Customer names: ${needsCustomerNames}`);

      let customerNamesAdded = 0;

      // Add customer names if needed
      if (needsCustomerNames) {
        console.log('👥 OrderEnhancementService: Adding customer names to MySQL...');
        customerNamesAdded = await this.addCustomerNamesToMySQL(orders);
      }

      console.log(`✅ OrderEnhancementService: MySQL enhancement completed - Customer names: ${customerNamesAdded}`);
      
      return {
        success: true,
        message: 'Orders enhanced successfully',
        customerNamesAdded
      };

    } catch (error) {
      console.error('❌ OrderEnhancementService: MySQL enhancement failed:', error);
      return { success: false, message: 'Enhancement failed: ' + error.message };
    }
  }


  /**
   * Add customer names from raw shipway data
   */
  async addCustomerNames(orders) {
    if (!fs.existsSync(this.rawShipwayPath)) {
      console.log('⚠️  OrderEnhancementService: raw_shipway_orders.json not found');
      return orders.map(order => ({ ...order, customer_name: 'N/A' }));
    }

    try {
      const rawData = JSON.parse(fs.readFileSync(this.rawShipwayPath, 'utf8'));
      let shipwayOrders = [];

      if (rawData.success === 1 && Array.isArray(rawData.message)) {
        shipwayOrders = rawData.message;
      } else if (rawData.success && rawData.data && Array.isArray(rawData.data.orders)) {
        shipwayOrders = rawData.data.orders;
      }

      // Create customer name lookup map
      const customerNameMap = {};
      shipwayOrders.forEach(order => {
        const orderId = order.order_id?.toString();
        const firstName = order.s_firstname || '';
        const lastName = order.s_lastname || '';
        const customerName = `${firstName} ${lastName}`.trim();
        
        if (orderId && customerName) {
          customerNameMap[orderId] = customerName;
        }
      });

      console.log(`🗺️  OrderEnhancementService: Created customer map with ${Object.keys(customerNameMap).length} entries`);

      // Add customer names to orders
      return orders.map(order => ({
        ...order,
        customer_name: customerNameMap[order.order_id] || 'N/A'
      }));

    } catch (error) {
      console.error('❌ OrderEnhancementService: Error adding customer names:', error.message);
      return orders.map(order => ({ ...order, customer_name: 'N/A' }));
    }
  }



  /**
   * Add customer names to MySQL orders
   */
  async addCustomerNamesToMySQL(orders) {
    let customerNamesAdded = 0;
    
    try {
      // Read raw Shipway data for customer names
      const rawData = JSON.parse(fs.readFileSync(this.rawShipwayPath, 'utf8'));
      const shipwayOrders = Array.isArray(rawData) ? rawData : (rawData.message || []);
      
      // Create a map of order_id to customer name
      const customerMap = new Map();
      shipwayOrders.forEach(order => {
        if (order.order_id) {
          const firstName = order.s_firstname || '';
          const lastName = order.s_lastname || '';
          const customerName = `${firstName} ${lastName}`.trim();
          
          if (customerName) {
            customerMap.set(order.order_id.toString(), customerName);
          }
        }
      });

      console.log(`🗺️  OrderEnhancementService: Created customer map with ${customerMap.size} entries for MySQL update`);

      // Update orders in MySQL
      for (const order of orders) {
        if (!order.customer_name && customerMap.has(order.order_id.toString())) {
          await database.updateOrder(order.unique_id, {
            customer_name: customerMap.get(order.order_id.toString())
          });
          customerNamesAdded++;
        }
      }
      
    } catch (error) {
      console.error('❌ OrderEnhancementService: Error adding customer names to MySQL:', error);
    }
    
    return customerNamesAdded;
  }

}

module.exports = new OrderEnhancementService(); 