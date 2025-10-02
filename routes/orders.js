const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { authenticateBasicAuth, requireAdminOrSuperadmin } = require('../middleware/auth');
const carrierServiceabilityService = require('../services/carrierServiceabilityService');

/**
 * @route   GET /api/orders
 * @desc    Get all orders from MySQL database
 * @access  Public (add auth as needed)
 */
router.get('/', async (req, res) => {
  try {
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const orders = await database.getAllOrders();
    return res.status(200).json({ success: true, data: { orders } });
  } catch (err) {
    console.error('Error getting orders:', err);
    return res.status(500).json({ success: false, message: 'Failed to read orders', error: err.message });
  }
});


/**
 * @route   GET /api/orders/last-updated
 * @desc    Get the last modification time from MySQL (returns current time for now)
 * @access  Public
 */
router.get('/last-updated', async (req, res) => {
  try {
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    // For MySQL, we'll return current time as last updated
    // In the future, we could add a last_updated column to track this
    return res.json({ 
      success: true, 
      data: {
        lastUpdated: new Date().toISOString() 
      }
    });
  } catch (err) {
    console.error('Error getting last updated time:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to get last updated time', 
      error: err.message 
    });
  }
});

/**
 * @route   POST /api/orders/claim
 * @desc    Vendor claims an order row by unique_id
 * @access  Vendor (token required)
 */
router.post('/claim', async (req, res) => {
  const { unique_id } = req.body;
  let token = req.headers['authorization'];
  
  // Handle case where token might be an object
  if (typeof token === 'object' && token !== null) {
    console.log('⚠️  Token received as object, attempting to extract string value');
    console.log('  - Object keys:', Object.keys(token));
    console.log('  - Object values:', Object.values(token));
    
    // Try to extract the actual token string
    if (token.token) {
      token = token.token;
    } else if (token.authorization) {
      token = token.authorization;
    } else if (Object.values(token).length === 1) {
      token = Object.values(token)[0];
    } else {
      console.log('❌ Cannot extract token from object');
      token = null;
    }
  }
  
  console.log('🔵 CLAIM REQUEST START');
  console.log('  - unique_id:', unique_id);
  console.log('  - token received:', token ? 'YES' : 'NO');
  console.log('  - token value:', token ? token.substring(0, 8) + '...' : 'null');
  
  if (!unique_id || !token) {
    console.log('❌ CLAIM FAILED: Missing required fields');
    return res.status(400).json({ success: false, message: 'unique_id and Authorization token required' });
  }

  // Load users from MySQL
  const database = require('../config/database');
  console.log('📂 Loading users from MySQL...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    console.log('👥 Users loaded from MySQL');
    console.log('🔍 Looking for token match...');
    console.log('  - Full token received:', token ? `"${token}"` : 'null');
    console.log('  - Token length:', token ? token.length : 0);
    console.log('  - Token type:', typeof token);
    console.log('  - Token JSON:', JSON.stringify(token));
    console.log('  - Token toString():', token ? token.toString() : 'null');
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('\n❌ VENDOR NOT FOUND OR INACTIVE:');
      console.log('  - Vendor object:', vendor);
      console.log('  - Full token provided:', token ? `"${token}"` : 'null');
      console.log('  - Token length:', token ? token.length : 0);
      console.log('  - Token type:', typeof token);
      console.log('  - Vendor found:', vendor ? 'YES' : 'NO');
      if (vendor) {
        console.log('  - Vendor active_session:', vendor.active_session);
        console.log('  - Vendor name:', vendor.name);
        console.log('  - Vendor warehouseId:', vendor.warehouseId);
      }
      
      const errorResponse = { success: false, message: 'Invalid or inactive vendor token' };
      console.log('\n📤 401 ERROR RESPONSE:');
      console.log('  - Status: 401');
      console.log('  - Response JSON:', JSON.stringify(errorResponse, null, 2));
      
      return res.status(401).json(errorResponse);
    }
    
    console.log('✅ VENDOR FOUND');
    console.log('  - warehouseId:', vendor.warehouseId);
    console.log('  - name:', vendor.name);
    console.log('  - active_session:', vendor.active_session);
    
    const warehouseId = vendor.warehouseId;

    // Get order from MySQL
    console.log('📂 Loading order from MySQL...');
    console.log('🔍 Looking for unique_id:', unique_id);
    
    const order = await database.getOrderByUniqueId(unique_id);
    
    if (!order) {
      console.log('❌ ORDER NOT FOUND');
      return res.status(404).json({ success: false, message: 'Order row not found' });
    }
    
    console.log('✅ ORDER FOUND');
    console.log('  - order_id:', order.order_id);
    console.log('  - product_name:', order.product_name);
    console.log('  - current status:', order.status);
    console.log('  - current claimed_by:', order.claimed_by);
    
    if (order.status !== 'unclaimed') {
      console.log('❌ ORDER NOT UNCLAIMED');
      console.log('  - Current status:', order.status);
      return res.status(400).json({ success: false, message: 'Order row is not unclaimed' });
    }
    
    // Update order
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log('🔄 UPDATING ORDER');
    console.log('  - Setting status to: claimed');
    console.log('  - Setting claimed_by to:', warehouseId);
    console.log('  - Setting timestamp to:', now);
    
    // Update order object in memory (like Excel behavior)
    const updatedOrder = {
      ...order,
      status: 'claimed',
      claimed_by: warehouseId,
      claimed_at: now,
      last_claimed_by: warehouseId,
      last_claimed_at: now
    };
    
    // Carrier assignment moved to label download process
    console.log('ℹ️ Carrier assignment will happen during label download');
    
    // Now save everything to MySQL in one go
    console.log('💾 SAVING TO MYSQL');
    const finalUpdatedOrder = await database.updateOrder(unique_id, {
      status: updatedOrder.status,
      claimed_by: updatedOrder.claimed_by,
      claimed_at: updatedOrder.claimed_at,
      last_claimed_by: updatedOrder.last_claimed_by,
      last_claimed_at: updatedOrder.last_claimed_at
    });
    
    if (!finalUpdatedOrder) {
      console.log('❌ FAILED TO UPDATE ORDER IN MYSQL');
      return res.status(500).json({ success: false, message: 'Failed to update order' });
    }
    
    console.log('✅ MYSQL SAVED SUCCESSFULLY');
    
    console.log('🟢 CLAIM SUCCESS');
    console.log('  - Order claimed by:', warehouseId);
    console.log('  - Updated order:', { unique_id: updatedOrder.unique_id, status: updatedOrder.status, claimed_by: updatedOrder.claimed_by });
    
    return res.json({ success: true, data: updatedOrder });
    
  } catch (error) {
    console.log('💥 CLAIM ERROR:', error.message);
    console.log('📍 Stack trace:', error.stack);
    return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
  }
});

/**
 * @route   POST /api/orders/bulk-claim
 * @desc    Vendor claims multiple orders by unique_ids
 * @access  Vendor (token required)
 */
router.post('/bulk-claim', async (req, res) => {
  const { unique_ids } = req.body;
  const token = req.headers['authorization'];
  
  console.log('🔵 BULK CLAIM REQUEST START');
  console.log('  - unique_ids:', unique_ids);
  console.log('  - token received:', token ? 'YES' : 'NO');
  
  if (!unique_ids || !Array.isArray(unique_ids) || unique_ids.length === 0 || !token) {
    console.log('❌ BULK CLAIM FAILED: Missing required fields');
    return res.status(400).json({ 
      success: false, 
      message: 'unique_ids array and Authorization token required' 
    });
  }

  // Load users from MySQL
  const database = require('../config/database');
  console.log('📂 Loading users from MySQL...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('❌ VENDOR NOT FOUND OR INACTIVE ', vendor);
      return res.status(401).json({ success: false, message: 'Invalid or inactive vendor token' });
    }
    
    console.log('✅ VENDOR FOUND');
    console.log('  - warehouseId:', vendor.warehouseId);
    
    const warehouseId = vendor.warehouseId;

    console.log('🔍 Processing bulk claim for', unique_ids.length, 'orders');
    
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const successfulClaims = [];
    const failedClaims = [];
    
    // Process each unique_id
    for (const unique_id of unique_ids) {
      console.log('🔍 Processing unique_id:', unique_id);
      
      const order = await database.getOrderByUniqueId(unique_id);
      
      if (!order) {
        console.log('❌ ORDER NOT FOUND:', unique_id);
        failedClaims.push({ unique_id, reason: 'Order not found' });
        continue;
      }
      
      if (order.status !== 'unclaimed') {
        console.log('❌ ORDER NOT UNCLAIMED:', unique_id, 'Status:', order.status);
        failedClaims.push({ unique_id, reason: 'Order is not unclaimed' });
        continue;
      }
      
      // Update order
      console.log('🔄 CLAIMING ORDER:', unique_id);
      
      // Update order object in memory (like Excel behavior)
      const updatedOrder = {
        ...order,
        status: 'claimed',
        claimed_by: warehouseId,
        claimed_at: now,
        last_claimed_by: warehouseId,
        last_claimed_at: now
      };
      
      // Carrier assignment moved to label download process
      console.log(`ℹ️ Carrier assignment for order ${order.order_id} will happen during label download`);
      
      // Now save everything to MySQL in one go
      const finalUpdatedOrder = await database.updateOrder(unique_id, {
        status: updatedOrder.status,
        claimed_by: updatedOrder.claimed_by,
        claimed_at: updatedOrder.claimed_at,
        last_claimed_by: updatedOrder.last_claimed_by,
        last_claimed_at: updatedOrder.last_claimed_at
      });
      
      if (finalUpdatedOrder) {
        successfulClaims.push({ unique_id, order_id: order.order_id });
        console.log('✅ ORDER CLAIMED SUCCESSFULLY:', unique_id);
      } else {
        console.log('❌ FAILED TO UPDATE ORDER:', unique_id);
        failedClaims.push({ unique_id, reason: 'Failed to update order' });
      }
    }
    
    if (successfulClaims.length > 0) {
      console.log('✅ MYSQL BULK UPDATE COMPLETED');
    }
    
    console.log('🟢 BULK CLAIM COMPLETE');
    console.log('  - Successful claims:', successfulClaims.length);
    console.log('  - Failed claims:', failedClaims.length);
    
    return res.json({ 
      success: true, 
      data: {
        successful_claims: successfulClaims,
        failed_claims: failedClaims,
        total_requested: unique_ids.length,
        total_successful: successfulClaims.length,
        total_failed: failedClaims.length
      }
    });
    
  } catch (error) {
    console.log('💥 BULK CLAIM ERROR:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
  }
});

/**
 * @route   GET /api/orders/grouped
 * @desc    Get vendor's claimed orders grouped by order_id
 * @access  Vendor (token required)
 */
router.get('/grouped', async (req, res) => {
  console.log('\n🔵 GROUPED ORDERS REQUEST START');
  console.log('================================');
  console.log('📥 Request Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📥 Request Method:', req.method);
  console.log('📥 Request URL:', req.url);
  console.log('📥 Request IP:', req.ip);
  
  let token = req.headers['authorization'];
  console.log('\n🔑 TOKEN ANALYSIS:');
  console.log('  - Raw token:', token);
  console.log('  - Token type:', typeof token);
  console.log('  - Token length:', token ? token.length : 0);
  console.log('  - Token JSON:', JSON.stringify(token));
  
  // Handle case where token might be an object
  if (typeof token === 'object' && token !== null) {
    console.log('\n⚠️  TOKEN RECEIVED AS OBJECT:');
    console.log('  - Object keys:', Object.keys(token));
    console.log('  - Object values:', Object.values(token));
    console.log('  - Object stringify:', JSON.stringify(token));
    
    // Try to extract the actual token string
    if (token.token) {
      token = token.token;
      console.log('  - Extracted from token.token:', token);
    } else if (token.authorization) {
      token = token.authorization;
      console.log('  - Extracted from token.authorization:', token);
    } else if (Object.values(token).length === 1) {
      token = Object.values(token)[0];
      console.log('  - Extracted from single value:', token);
    } else {
      console.log('❌ Cannot extract token from object');
      token = null;
    }
  }
  
  console.log('🔵 GROUPED ORDERS REQUEST START');
    console.log('  - token received:', token ? 'YES' : 'NO');
    console.log('  - Full token:', token ? `"${token}"` : 'null');
    console.log('  - Token length:', token ? token.length : 0);

    
    console.log('  - Full token:', token ? `"${token}"` : 'null');
  
  if (!token) {
    console.log('❌ GROUPED ORDERS FAILED: Missing token');
    return res.status(400).json({ success: false, message: 'Authorization token required' });
  }

  // Load users from MySQL
  const database = require('../config/database');
  console.log('📂 Loading users from MySQL...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('❌ VENDOR NOT FOUND OR INACTIVE ', vendor);
      return res.status(401).json({ success: false, message: 'Invalid or inactive vendor token' });
    }
    
    console.log('✅ VENDOR FOUND');
    console.log('  - warehouseId:', vendor.warehouseId);
    
    const warehouseId = vendor.warehouseId;

    // Get individual orders from MySQL (like original Excel flow)
    console.log('📂 Loading vendor orders from MySQL...');
    
    const vendorOrders = await database.getGroupedOrders(warehouseId);
    
    console.log('📦 Vendor orders loaded:', vendorOrders.length);
    
    // Group orders by order_id (exact same logic as original Excel flow)
    const groupedOrders = {};
    
    vendorOrders.forEach(order => {
      const orderId = order.order_id;
      
      if (!groupedOrders[orderId]) {
        groupedOrders[orderId] = {
          order_id: orderId, // Always use the actual order_id (clone ID if cloned)
          status: order.status,
          order_date: order.order_date || order.created_at,
          customer_name: order.customer_name || order.customer,
          claimed_at: order.claimed_at,
          label_downloaded: order.label_downloaded, // Add label_downloaded field
          total_value: 0,
          total_products: 0,
          products: []
        };
      }
      
      // Add product to the group (exact same structure as original Excel flow)
      groupedOrders[orderId].products.push({
        unique_id: order.unique_id,
        product_name: order.product_name || order.product,
        product_code: order.product_code,
        value: order.value || order.price || 0,
        image: order.image || order.product_image,
        quantity: order.quantity || 1
      });
      
      // Update totals
      const productValue = parseFloat(order.value || order.price || 0);
      groupedOrders[orderId].total_value += productValue;
      groupedOrders[orderId].total_products += 1;
    });
    
    // Convert to array and sort by order_date (exact same logic as original Excel flow)
    const groupedOrdersArray = Object.values(groupedOrders).sort((a, b) => {
      const dateA = new Date(a.order_date || 0);
      const dateB = new Date(b.order_date || 0);
      return dateB - dateA; // Most recent first
    });
    
    console.log('📊 Grouped orders processed:', groupedOrdersArray.length);
    console.log('🟢 GROUPED ORDERS SUCCESS');
    
    const responseData = { 
      success: true, 
      data: { 
        groupedOrders: groupedOrdersArray,
        totalOrders: groupedOrdersArray.length,
        totalProducts: vendorOrders.length
      }
    };
    
    console.log('\n📤 RESPONSE DATA:');
    console.log('  - Status: 200');
    console.log('  - Success:', responseData.success);
    console.log('  - Total Orders:', responseData.data.totalOrders);
    console.log('  - Total Products:', responseData.data.totalProducts);
    console.log('  - Grouped Orders Count:', responseData.data.groupedOrders.length);
    console.log('  - Response JSON:', JSON.stringify(responseData, null, 2));
    
    return res.json(responseData);
    
  } catch (error) {
    console.log('\n💥 GROUPED ORDERS ERROR:');
    console.log('  - Error message:', error.message);
    console.log('  - Error stack:', error.stack);
    console.log('  - Error name:', error.name);
    
    const errorResponse = { success: false, message: 'Internal server error: ' + error.message };
    console.log('\n📤 ERROR RESPONSE:');
    console.log('  - Status: 500');
    console.log('  - Response JSON:', JSON.stringify(errorResponse, null, 2));
    
    return res.status(500).json(errorResponse);
  }
});

/**
 * @route   GET /api/orders/admin/all
 * @desc    Get all orders with vendor information for admin panel
 * @access  Admin/Superadmin only
 */
router.get('/admin/all', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  console.log('🔵 ADMIN ORDERS REQUEST START');
  
  try {
    // Load orders from MySQL
    const database = require('../config/database');
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({
        success: false,
        message: 'Database connection not available'
      });
    }
    
    const orders = await database.getAllOrders();
    console.log('📦 Orders loaded from MySQL:', orders.length);
    
    const allUsers = await database.getAllUsers();
    const vendors = allUsers.filter(user => user.role === 'vendor');
    console.log('👥 Vendors loaded from MySQL:', vendors.length);
    
    // Create vendor lookup map
    const vendorMap = {};
    vendors.forEach(vendor => {
      vendorMap[vendor.warehouseId] = {
        name: vendor.name,
        email: vendor.email,
        phone: vendor.phone,
        status: vendor.status || 'inactive',
      };
    });
    
    // Process orders and add vendor information
    const rowsNeedingFix = [];
    const processedOrders = orders.map((order, idx) => {
      const vendorInfo = order.claimed_by ? vendorMap[order.claimed_by] : null;
      const vendorIsActive = vendorInfo && String(vendorInfo.status).toLowerCase() === 'active';
      let status = order.status || 'unclaimed';
      let vendorName = vendorInfo ? vendorInfo.name : (order.claimed_by ? order.claimed_by : 'Unclaimed');

      // If order is claimed but vendor is missing or inactive, treat as unclaimed and queue a fix
      if ((order.claimed_by && !vendorIsActive) && status !== 'unclaimed') {
        status = 'unclaimed';
        vendorName = 'Unclaimed';
        rowsNeedingFix.push(idx);
      }

      return {
        unique_id: order.unique_id,
        order_id: order.order_id,
        customer_name: order.customer_name || order.customer || 'N/A',
        vendor_name: vendorName,
        product_name: order.product_name || order.product || 'N/A',
        status,
        value: order.value || order.price || order.selling_price || '0',
        priority: order.priority || 'medium',
        created_at: order.created_at || order.order_date || 'N/A',
        claimed_at: order.claimed_at || null,
        claimed_by: order.claimed_by || null,
        image: order.product_image || order.image || '/placeholder.svg'
      };
    });

    // Persist fixes back to MySQL if necessary
    if (rowsNeedingFix.length > 0) {
      const database = require('../config/database');
      for (const idx of rowsNeedingFix) {
        const order = orders[idx];
        try {
          await database.updateOrder(order.unique_id, {
            status: 'unclaimed',
            claimed_by: '',
            claimed_at: null
          });
        } catch (error) {
          console.error(`❌ Failed to update order ${order.unique_id}:`, error.message);
        }
      }
      console.log(`🧹 Cleaned ${rowsNeedingFix.length} orders claimed by missing/inactive vendors`);
    }
    
    console.log('🟢 ADMIN ORDERS SUCCESS');
    console.log('  - Processed orders:', processedOrders.length);
    
    return res.status(200).json({ 
      success: true, 
      data: { 
        orders: processedOrders,
        totalOrders: processedOrders.length,
        claimedOrders: processedOrders.filter(o => o.status === 'claimed').length,
        unclaimedOrders: processedOrders.filter(o => o.status === 'unclaimed').length
      } 
    });
    
  } catch (error) {
    console.log('💥 ADMIN ORDERS ERROR:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch orders for admin panel', 
      error: error.message 
    });
  }
});

/**
 * @route   POST /api/orders/admin/assign
 * @desc    Admin assigns an order to a vendor
 * @access  Admin/Superadmin only
 */
router.post('/admin/assign', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  const { unique_id, vendor_warehouse_id } = req.body;
  
  console.log('🔵 ADMIN ASSIGN ORDER REQUEST START');
  console.log('  - unique_id:', unique_id);
  console.log('  - vendor_warehouse_id:', vendor_warehouse_id);
  
  if (!unique_id || !vendor_warehouse_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'unique_id and vendor_warehouse_id are required' 
    });
  }

  try {
    // Load users from MySQL to verify vendor exists
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const vendor = await database.getUserByWarehouseId(vendor_warehouse_id);
    if (!vendor || vendor.role !== 'vendor') {
      return res.status(400).json({ 
        success: false, 
        message: 'Vendor not found or invalid warehouse ID' 
      });
    }
    
    console.log('✅ VENDOR FOUND:', vendor.name);

    // Get order from MySQL
    const order = await database.getOrderByUniqueId(unique_id);
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }
    
    console.log('✅ ORDER FOUND:', order.order_id);
    
    // Update order assignment in MySQL
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const updatedOrder = await database.updateOrder(unique_id, {
      status: 'claimed',
      claimed_by: vendor_warehouse_id,
      claimed_at: now,
      last_claimed_by: vendor_warehouse_id,
      last_claimed_at: now
    });
    
    if (!updatedOrder) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update order' 
      });
    }
    
    console.log('✅ ORDER ASSIGNED SUCCESSFULLY');
    console.log(`  - Order ${order.order_id} assigned to ${vendor.name} (${vendor_warehouse_id})`);
    
    return res.json({ 
      success: true, 
      message: `Order ${updatedOrder.order_id} assigned to ${vendor.name}`,
      data: {
        order_id: updatedOrder.order_id,
        vendor_name: vendor.name,
        vendor_warehouse_id: vendor_warehouse_id,
        assigned_at: now
      }
    });
    
  } catch (error) {
    console.error('💥 ADMIN ASSIGN ERROR:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error: ' + error.message 
    });
  }
});

/**
 * @route   POST /api/orders/admin/bulk-assign
 * @desc    Admin assigns multiple orders to a vendor
 * @access  Admin/Superadmin only
 */
router.post('/admin/bulk-assign', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  const { unique_ids, vendor_warehouse_id } = req.body || {};

  console.log('🔵 ADMIN BULK ASSIGN REQUEST START');
  console.log('  - unique_ids count:', Array.isArray(unique_ids) ? unique_ids.length : 0);
  console.log('  - vendor_warehouse_id:', vendor_warehouse_id);

  if (!Array.isArray(unique_ids) || unique_ids.length === 0 || !vendor_warehouse_id) {
    return res.status(400).json({ success: false, message: 'unique_ids (array) and vendor_warehouse_id are required' });
  }

  try {
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }

    // Verify vendor exists in MySQL
    const vendor = await database.getUserByWarehouseId(vendor_warehouse_id);
    if (!vendor || vendor.role !== 'vendor') {
      return res.status(400).json({ success: false, message: 'Vendor not found or invalid warehouse ID' });
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    let updatedCount = 0;
    
    // Update each order in MySQL
    for (const uid of unique_ids) {
      try {
        const result = await database.updateOrder(uid, {
          status: 'claimed',
          claimed_by: vendor_warehouse_id,
          claimed_at: now,
          last_claimed_by: vendor_warehouse_id,
          last_claimed_at: now
        });
        
        if (result.success) {
          updatedCount += 1;
        }
      } catch (error) {
        console.error(`❌ Failed to update order ${uid}:`, error.message);
      }
    }

    return res.json({
      success: true,
      message: `Assigned ${updatedCount} orders to ${vendor.name}`,
      data: { updated: updatedCount, vendor_warehouse_id }
    });
  } catch (error) {
    console.error('💥 ADMIN BULK ASSIGN ERROR:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
  }
});

/**
 * @route   POST /api/orders/admin/bulk-unassign
 * @desc    Admin unassigns multiple orders
 * @access  Admin/Superadmin only
 */
router.post('/admin/bulk-unassign', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  const { unique_ids } = req.body || {};

  console.log('🔵 ADMIN BULK UNASSIGN REQUEST START');
  console.log('  - unique_ids count:', Array.isArray(unique_ids) ? unique_ids.length : 0);

  if (!Array.isArray(unique_ids) || unique_ids.length === 0) {
    return res.status(400).json({ success: false, message: 'unique_ids (array) is required' });
  }

  try {
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }

    let updatedCount = 0;
    
    // Update each order in MySQL
    for (const uid of unique_ids) {
      try {
        // First check if order exists and is claimed
        const order = await database.getOrderByUniqueId(uid);
        if (order && order.status !== 'unclaimed') {
          const result = await database.updateOrder(uid, {
            status: 'unclaimed',
            claimed_by: '',
            claimed_at: null
          });
          
          if (result.success) {
            updatedCount += 1;
          }
        }
      } catch (error) {
        console.error(`❌ Failed to update order ${uid}:`, error.message);
      }
    }

    return res.json({ success: true, message: `Unassigned ${updatedCount} orders`, data: { updated: updatedCount } });
  } catch (error) {
    console.error('💥 ADMIN BULK UNASSIGN ERROR:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
  }
});

/**
 * @route   POST /api/orders/admin/unassign
 * @desc    Admin unassigns an order from a vendor
 * @access  Admin/Superadmin only
 */
router.post('/admin/unassign', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  const { unique_id } = req.body;
  
  console.log('🔵 ADMIN UNASSIGN ORDER REQUEST START');
  console.log('  - unique_id:', unique_id);
  
  if (!unique_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'unique_id is required' 
    });
  }

  try {
    // Load database
    const database = require('../config/database');
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    // Get order from MySQL
    const order = await database.getOrderByUniqueId(unique_id);
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }
    
    console.log('✅ ORDER FOUND:', order.order_id);
    
    if (order.status === 'unclaimed') {
      return res.status(400).json({ 
        success: false, 
        message: 'Order is already unclaimed' 
      });
    }
    
    const previousVendor = order.claimed_by;
    
    // Update order to unclaimed in MySQL
    const updatedOrder = await database.updateOrder(unique_id, {
      status: 'unclaimed',
      claimed_by: '',
      claimed_at: null
      // Keep last_claimed_by and last_claimed_at for history
    });
    
    if (!updatedOrder) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update order' 
      });
    }
    
    console.log('✅ ORDER UNASSIGNED SUCCESSFULLY');
    console.log(`  - Order ${order.order_id} unassigned from ${previousVendor}`);
    
    return res.json({ 
      success: true, 
      message: `Order ${updatedOrder.order_id} unassigned successfully`,
      data: {
        order_id: updatedOrder.order_id,
        previous_vendor: previousVendor,
        unassigned_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
      }
    });
    
  } catch (error) {
    console.error('💥 ADMIN UNASSIGN ERROR:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error: ' + error.message 
    });
  }
});

/**
 * @route   GET /api/orders/admin/vendors
 * @desc    Get all active vendors for admin assignment dropdown
 * @access  Admin/Superadmin only
 */
router.get('/admin/vendors', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  console.log('🔵 ADMIN GET VENDORS REQUEST START');
  
  try {
    // Load users from MySQL to get all vendors
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    // Get all active vendors
    const allUsers = await database.getAllUsers();
    const vendors = allUsers
      .filter(user => user.role === 'vendor' && user.status === 'active')
      .map(vendor => ({
        warehouse_id: vendor.warehouseId,
        name: vendor.name,
        email: vendor.email,
        phone: vendor.phone
      }));
    
    console.log('✅ VENDORS LOADED:', vendors.length);
    
    return res.status(200).json({ 
      success: true, 
      data: { vendors }
    });
    
  } catch (error) {
    console.log('💥 ADMIN GET VENDORS ERROR:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch vendors', 
      error: error.message 
    });
  }
});

/**
 * @route   POST /api/orders/assign-priority-carriers
 * @desc    Assign priority carriers to all claimed orders based on serviceability
 * @access  Admin/Superadmin only
 */
router.post('/assign-priority-carriers', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  console.log('🔵 PRIORITY CARRIER ASSIGNMENT REQUEST START');
  
  try {
    console.log('📡 Starting priority carrier assignment process for claimed orders...');
    
    // Start the assignment process
    const result = await carrierServiceabilityService.assignPriorityCarriersToOrders();
    
    console.log('✅ PRIORITY CARRIER ASSIGNMENT COMPLETED');
    console.log('📊 Results:', result);
    
    return res.status(200).json({
      success: true,
      message: 'Priority carriers assigned successfully to claimed orders',
      data: result
    });
    
  } catch (error) {
    console.error('💥 PRIORITY CARRIER ASSIGNMENT ERROR:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign priority carriers',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/orders/assign-priority-carrier/:orderId
 * @desc    Assign priority carrier to a specific claimed order
 * @access  Admin/Superadmin only
 */
router.post('/assign-priority-carrier/:orderId', authenticateBasicAuth, requireAdminOrSuperadmin, async (req, res) => {
  const { orderId } = req.params;
  
  console.log('🔵 SINGLE ORDER PRIORITY CARRIER ASSIGNMENT REQUEST START');
  console.log('  - Order ID:', orderId);
  
  try {
    console.log('📡 Starting priority carrier assignment for single order...');
    
    // Start the assignment process for single order
    const result = await carrierServiceabilityService.assignPriorityCarrierToOrder(orderId);
    
    console.log('✅ SINGLE ORDER PRIORITY CARRIER ASSIGNMENT COMPLETED');
    console.log('📊 Results:', result);
    
    return res.status(200).json({
      success: true,
      message: 'Priority carrier assigned successfully to order',
      data: result
    });
    
  } catch (error) {
    console.error('💥 SINGLE ORDER PRIORITY CARRIER ASSIGNMENT ERROR:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign priority carrier to order',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/orders/priority-carrier-stats
 * @desc    Get statistics about priority carrier assignments (claimed vs unclaimed orders)
 * @access  Admin/Superadmin only
 */
router.get('/priority-carrier-stats', authenticateBasicAuth, requireAdminOrSuperadmin, (req, res) => {
  console.log('🔵 PRIORITY CARRIER STATS REQUEST START');
  
  try {
    const stats = carrierServiceabilityService.getAssignmentStatistics();
    
    console.log('✅ PRIORITY CARRIER STATS RETRIEVED');
    
    return res.status(200).json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('💥 PRIORITY CARRIER STATS ERROR:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to get priority carrier statistics',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/orders/download-label
 * @desc    Download label for an order (with clone logic if needed)
 * @access  Vendor (token required)
 */
router.post('/download-label', async (req, res) => {
  const { order_id } = req.body;
  const token = req.headers['authorization'];
  
  console.log('🔵 DOWNLOAD LABEL REQUEST START');
  console.log('  - order_id:', order_id);
  console.log('  - token received:', token ? 'YES' : 'NO');
  
  if (!order_id || !token) {
    console.log('❌ DOWNLOAD LABEL FAILED: Missing required fields');
    return res.status(400).json({ success: false, message: 'order_id and Authorization token required' });
  }

  try {
    // Load users from MySQL to get vendor info
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    console.log('🔍 DOWNLOAD LABEL DEBUG:');
    console.log('  - Token received:', token ? token.substring(0, 20) + '...' : 'null');
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('❌ VENDOR NOT FOUND OR INACTIVE ', vendor);
      console.log('  - Token comparison failed');
      return res.status(401).json({ success: false, message: 'Invalid or inactive vendor token' });
    }

    console.log('✅ VENDOR FOUND:');
    console.log('  - Email:', vendor.email);
    console.log('  - Warehouse ID:', vendor.warehouseId);
    console.log('  - Role:', vendor.role);
    console.log('  - Active session:', vendor.active_session);

    // Get orders from MySQL
    const orders = await database.getAllOrders();

    // Get all products for this order_id
    const orderProducts = orders.filter(order => order.order_id === order_id);
    const claimedProducts = orderProducts.filter(order => 
      order.claimed_by === vendor.warehouseId && order.status === 'claimed'
    );

    console.log('📊 Order Analysis:');
    console.log('  - Order ID requested:', order_id);
    console.log('  - Vendor warehouse ID:', vendor.warehouseId);
    console.log('  - Total products in order:', orderProducts.length);
    console.log('  - Products claimed by vendor:', claimedProducts.length);
    
    // Debug: Show all products for this order
    console.log('🔍 All products for order:', order_id);
    orderProducts.forEach((product, index) => {
      console.log(`  ${index + 1}. Product: ${product.product_name}`);
      console.log(`     - Status: ${product.status}`);
      console.log(`     - Claimed by: ${product.claimed_by}`);
      console.log(`     - Match: ${product.claimed_by === vendor.warehouseId && product.status === 'claimed' ? 'YES' : 'NO'}`);
    });

    // Check if label already downloaded for this order_id
    console.log('🔍 Checking if label already downloaded...');
    const orderWithLabel = orderProducts.find(product => 
      product.claimed_by === vendor.warehouseId && 
      product.status === 'claimed' && 
      product.label_downloaded === 1
    );
    
    if (orderWithLabel && claimedProducts.length > 0) {
      console.log('✅ LABEL ALREADY DOWNLOADED: Found label_downloaded = 1 in orders table');
      console.log(`  - Order ID: ${order_id}`);
      console.log(`  - Checking labels table for cached URL...`);
      
      const cachedLabel = await database.getLabelByOrderId(order_id);
      
      if (cachedLabel) {
        console.log('✅ CACHED LABEL FOUND: Returning cached label URL');
        console.log(`  - Cached Label URL: ${cachedLabel.label_url}`);
        console.log(`  - Cached AWB: ${cachedLabel.awb}`);
        
        return res.json({
          success: true,
          message: 'Label retrieved from cache',
          data: {
            shipping_url: cachedLabel.label_url,
            awb: cachedLabel.awb,
            original_order_id: order_id,
            clone_order_id: order_id,
            cached: true
          }
        });
      } else {
        console.log('⚠️ label_downloaded = 1 but no cached URL found, regenerating...');
      }
    }
    
    console.log('🔍 No downloaded label found, proceeding with label generation...');

    // Debug: Log product counts and details
    console.log(`📊 Product Analysis for ${order_id}:`);
    console.log(`  - Total products in order: ${orderProducts.length}`);
    console.log(`  - Products claimed by vendor: ${claimedProducts.length}`);
    console.log(`  - All products:`, orderProducts.map(p => ({ unique_id: p.unique_id, product_code: p.product_code, claimed_by: p.claimed_by, status: p.status })));
    console.log(`  - Claimed products:`, claimedProducts.map(p => ({ unique_id: p.unique_id, product_code: p.product_code, claimed_by: p.claimed_by, status: p.status })));

    // Updated logic: Only 2 conditions (removed underscore check)
    if (orderProducts.length === claimedProducts.length) {
      // Condition 1: Direct download - all products claimed by vendor
      console.log('✅ CONDITION 1: Direct download - all products claimed by vendor');
      
      const labelResponse = await generateLabelForOrder(order_id, claimedProducts, vendor);
      
      // Store label in cache after successful generation
      if (labelResponse.success && labelResponse.data.shipping_url) {
        try {
          const labelDataToStore = {
            order_id: order_id,
            label_url: labelResponse.data.shipping_url,
            awb: labelResponse.data.awb,
            carrier_id: labelResponse.data.carrier_id,
            carrier_name: labelResponse.data.carrier_name,
            priority_carrier: labelResponse.data.carrier_id
          };
          
          console.log(`📦 Storing label data for direct download:`, labelDataToStore);
          
          await database.upsertLabel(labelDataToStore);
          console.log(`✅ Stored label and carrier info for direct download order ${order_id}`);
          console.log(`  - Carrier: ${labelResponse.data.carrier_id} (${labelResponse.data.carrier_name})`);
          
          // ✅ Mark label as downloaded in claims table for all claimed products
          for (const product of claimedProducts) {
            await database.updateOrder(product.unique_id, {
              label_downloaded: 1  // Mark as downloaded after successful label generation
            });
            console.log(`  ✅ Marked product ${product.unique_id} label as downloaded`);
          }
          
        } catch (cacheError) {
          console.log(`⚠️ Failed to cache label URL: ${cacheError.message}`);
          console.log(`  - Error details:`, cacheError);
        }
      }
      
      return res.json(labelResponse);
      
    } else if (claimedProducts.length > 0) {
      // Condition 2: Clone required - some products claimed by vendor
      console.log('🔄 CONDITION 2: Clone required - some products claimed by vendor');
      
      const cloneResponse = await handleOrderCloning(order_id, claimedProducts, orderProducts, vendor);
      return res.json(cloneResponse);
      
    } else {
      // No products claimed by this vendor
      console.log('❌ No products claimed by this vendor for order:', order_id);
      return res.status(400).json({ 
        success: false, 
        message: 'No products claimed by this vendor for this order' 
      });
    }

  } catch (error) {
    console.error('❌ DOWNLOAD LABEL ERROR:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to download label', 
      error: error.message 
    });
  }
});

/**
 * Generate label for an order (Condition 1: Direct download)
 */
async function generateLabelForOrder(orderId, products, vendor) {
  try {
    console.log('🔄 Generating label for order:', orderId);
    
    // Extract original order ID if this is a clone
    const originalOrderId = orderId.includes('_') ? orderId.split('_')[0] : orderId;
    console.log('  - Original order ID for contact info:', originalOrderId);
    
    // Load raw shipway orders for contact info
    const rawOrdersPath = path.join(__dirname, '../data/raw_shipway_orders.json');
    const rawOrdersData = JSON.parse(fs.readFileSync(rawOrdersPath, 'utf8'));
    const originalOrder = rawOrdersData.message.find(order => order.order_id === originalOrderId);
    
    if (!originalOrder) {
      throw new Error(`Original order not found in raw_shipway_orders.json for order ID: ${originalOrderId}`);
    }

    // STEP 1: Assign carrier for the current order_id (original or clone)
    console.log(`🚚 ASSIGNING PRIORITY CARRIER for order ${orderId}...`);
    let assignedCarrier = null;
    try {
      // Get the first product to determine payment type and status
      const firstProduct = products[0];
      
      // Create a complete order object for carrier assignment
      const tempOrder = {
        order_id: orderId,
        pincode: originalOrder.s_zipcode,
        payment_type: firstProduct.payment_type,
        status: 'claimed',  // Required for carrier assignment
        claimed_by: vendor.warehouseId  // Required for carrier assignment
      };
      
      console.log(`  - Order details for carrier assignment:`, {
        order_id: tempOrder.order_id,
        pincode: tempOrder.pincode,
        payment_type: tempOrder.payment_type,
        status: tempOrder.status,
        claimed_by: tempOrder.claimed_by
      });
      
      console.log(`  - Products for carrier assignment:`, products.map(p => ({
        unique_id: p.unique_id,
        product_code: p.product_code,
        payment_type: p.payment_type
      })));
      
      const carrierServiceabilityService = require('../services/carrierServiceabilityService');
      const carrierResult = await carrierServiceabilityService.assignPriorityCarrierToOrderInMemory(tempOrder);
      assignedCarrier = {
        carrier_id: carrierResult.data.carrier_id,
        carrier_name: carrierResult.data.carrier_name
      };
      console.log(`✅ Carrier assigned for ${orderId}: ${assignedCarrier.carrier_id} (${assignedCarrier.carrier_name})`);
    } catch (carrierError) {
      console.log(`⚠️ Carrier assignment failed for ${orderId}: ${carrierError.message}`);
      assignedCarrier = { carrier_id: '', carrier_name: '' };
    }

    // Prepare request body for PUSH Order with Label Generation API
    const requestBody = prepareShipwayRequestBody(orderId, products, originalOrder, vendor, true); // true for label generation
    
    // Call Shipway API
    const response = await callShipwayPushOrderAPI(requestBody, true); // true for label generation
    
    console.log('🔍 Shipway API Response Structure:');
    console.log('  - Full response:', JSON.stringify(response, null, 2));
    console.log('  - Response keys:', Object.keys(response));
    
    // Handle different possible response structures
    let shipping_url, awb;
    
    if (response.awb_response) {
      shipping_url = response.awb_response.shipping_url;
      awb = response.awb_response.AWB;
    } else if (response.shipping_url) {
      shipping_url = response.shipping_url;
      awb = response.AWB || response.awb;
    } else if (response.data && response.data.awb_response) {
      shipping_url = response.data.awb_response.shipping_url;
      awb = response.data.awb_response.AWB;
    } else if (response.data && response.data.shipping_url) {
      shipping_url = response.data.shipping_url;
      awb = response.data.AWB || response.data.awb;
    } else {
      console.log('❌ Could not find shipping_url in response structure');
      console.log('  - Available keys:', Object.keys(response));
      throw new Error('Invalid response structure from Shipway API - missing shipping_url');
    }
    
    console.log('✅ Label generated successfully');
    console.log('  - Shipping URL:', shipping_url);
    console.log('  - AWB:', awb);
    
    return {
      success: true,
      message: 'Label generated successfully',
      data: {
        shipping_url: shipping_url,
        awb: awb,
        order_id: orderId,
        carrier_id: assignedCarrier.carrier_id,
        carrier_name: assignedCarrier.carrier_name
      }
    };
    
  } catch (error) {
    console.error('❌ Label generation failed:', error);
    throw error;
  }
}

/**
 * Handle order cloning (Condition 2: Clone required)
 */
async function handleOrderCloning(originalOrderId, claimedProducts, allOrderProducts, vendor) {
  const MAX_ATTEMPTS = 5;
  let cloneOrderId;
  
  console.log('🚀 Starting updated clone process...');
  console.log(`📊 Input Analysis:`);
  console.log(`  - Original Order ID: ${originalOrderId}`);
  console.log(`  - Total products in order: ${allOrderProducts.length}`);
  console.log(`  - Products claimed by vendor: ${claimedProducts.length}`);
  console.log(`  - Vendor warehouse ID: ${vendor.warehouseId}`);
  
  try {
    // ============================================================================
    // STEP 0: DATA PREPARATION & CONSISTENCY
    // ============================================================================
    console.log('\n📋 STEP 0: Capturing and freezing input data...');
    
    const inputData = await prepareInputData(originalOrderId, claimedProducts, allOrderProducts, vendor);
    cloneOrderId = inputData.cloneOrderId;
    
    console.log(`✅ Input data captured and frozen:`);
    console.log(`  - Clone Order ID: ${cloneOrderId}`);
    console.log(`  - Claimed products: ${inputData.claimedProducts.length}`);
    console.log(`  - Remaining products: ${inputData.remainingProducts.length}`);
    console.log(`  - Data timestamp: ${inputData.timestamp}`);
    
    // ============================================================================
    // STEP 1: CREATE CLONE ORDER (NO LABEL)
    // ============================================================================
    console.log('\n🔧 STEP 1: Creating clone order (without label)...');
    
    await retryOperation(
      (data) => createCloneOrderOnly(data),
      MAX_ATTEMPTS,
      'Create clone order',
      inputData
    );
    
    console.log('✅ STEP 1 COMPLETED: Clone order created successfully');
    
    // ============================================================================
    // STEP 2: VERIFY CLONE CREATION
    // ============================================================================
    console.log('\n🔍 STEP 2: Verifying clone creation...');
    
    await retryOperation(
      (data) => verifyCloneExists(data),
      MAX_ATTEMPTS,
      'Verify clone creation',
      inputData
    );
    
    console.log('✅ STEP 2 COMPLETED: Clone creation verified');
    
    // ============================================================================
    // STEP 3: UPDATE ORIGINAL ORDER
    // ============================================================================
    console.log('\n📝 STEP 3: Updating original order (removing claimed products)...');
    
    await retryOperation(
      (data) => updateOriginalOrder(data),
      MAX_ATTEMPTS,
      'Update original order',
      inputData
    );
    
    console.log('✅ STEP 3 COMPLETED: Original order updated');
    
    // ============================================================================
    // STEP 4: VERIFY ORIGINAL ORDER UPDATE
    // ============================================================================
    console.log('\n🔍 STEP 4: Verifying original order update...');
    
    await retryOperation(
      (data) => verifyOriginalOrderUpdate(data),
      MAX_ATTEMPTS,
      'Verify original order update',
      inputData
    );
    
    console.log('✅ STEP 4 COMPLETED: Original order update verified');
    
    // ============================================================================
    // STEP 5: UPDATE LOCAL DATABASE (AFTER CLONE CREATION)
    // ============================================================================
    console.log('\n💾 STEP 5: Updating local database after clone creation...');
    
    await retryOperation(
      (data) => updateLocalDatabaseAfterClone(data),
      MAX_ATTEMPTS,
      'Update local database after clone',
      inputData
    );
    
    console.log('✅ STEP 5 COMPLETED: Local database updated');
    
    // ============================================================================
    // STEP 6: GENERATE LABEL FOR CLONE
    // ============================================================================
    console.log('\n🏷️ STEP 6: Generating label for clone order...');
    
    const labelResponse = await retryOperation(
      (data) => generateLabelForClone(data),
      MAX_ATTEMPTS,
      'Generate clone order label',
      inputData
    );
    
    console.log('✅ STEP 6 COMPLETED: Label generated successfully');
    
    // ============================================================================
    // STEP 7: MARK LABEL AS DOWNLOADED AND STORE IN LABELS TABLE
    // ============================================================================
    console.log('\n✅ STEP 7: Marking label as downloaded and caching URL...');
    
    await retryOperation(
      (data) => markLabelAsDownloaded(data, labelResponse),
      MAX_ATTEMPTS,
      'Mark label as downloaded and cache URL',
      inputData
    );
    
    console.log('✅ STEP 7 COMPLETED: Label marked as downloaded and cached');
    
    // ============================================================================
    // STEP 8: RETURN SUCCESS
    // ============================================================================
    console.log('\n🎉 STEP 8: Clone process completed successfully!');
    console.log(`  - Original Order ID: ${inputData.originalOrderId}`);
    console.log(`  - Clone Order ID: ${cloneOrderId}`);
    console.log(`  - Label URL: ${labelResponse.data.shipping_url}`);
    console.log(`  - AWB: ${labelResponse.data.awb}`);
    
    return {
      success: true,
      message: 'Order cloned and label generated successfully',
      data: {
        shipping_url: labelResponse.data.shipping_url,
        awb: labelResponse.data.awb,
        original_order_id: inputData.originalOrderId,
        clone_order_id: cloneOrderId
      }
    };
    
  } catch (error) {
    console.error(`❌ Clone process failed after ${MAX_ATTEMPTS} attempts for each step:`, error);
    throw new Error(`Order cloning failed: ${error.message}`);
  }
}

/**
 * Helper Functions for Updated Clone Logic
 */

// Generic retry function with exponential backoff
async function retryOperation(operation, maxAttempts, stepName, inputData) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔄 ${stepName} - Attempt ${attempt}/${maxAttempts}`);
      console.log(`🔒 Using consistent input data (captured at: ${inputData.timestamp})`);
      
      // Pass the same inputData to every attempt
      const result = await operation(inputData);
      console.log(`✅ ${stepName} - Success on attempt ${attempt}`);
      return result;
      
    } catch (error) {
      lastError = error;
      console.log(`❌ ${stepName} - Failed on attempt ${attempt}: ${error.message}`);
      
      if (attempt === maxAttempts) {
        console.log(`💥 ${stepName} - All ${maxAttempts} attempts failed with same data`);
        break;
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 1s, 2s, 4s, 8s, 10s max
      console.log(`⏳ ${stepName} - Waiting ${waitTime}ms before retry with SAME data...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw lastError;
}

// Step 0: Prepare and freeze input data
async function prepareInputData(originalOrderId, claimedProducts, allOrderProducts, vendor) {
  console.log('📋 Capturing input data for clone process...');
  
  // Generate unique clone ID
  const cloneOrderId = await generateUniqueCloneId(originalOrderId);
  
  // Load original order data once
  const rawOrdersPath = path.join(__dirname, '../data/raw_shipway_orders.json');
  const rawOrdersData = JSON.parse(fs.readFileSync(rawOrdersPath, 'utf8'));
  const originalOrder = rawOrdersData.message.find(order => order.order_id === originalOrderId);
  
  if (!originalOrder) {
    throw new Error('Original order not found in raw_shipway_orders.json');
  }
  
  const inputData = {
    originalOrderId,
    claimedProducts: [...claimedProducts], // Deep copy to prevent mutations
    allOrderProducts: [...allOrderProducts], // Deep copy
    vendor: { ...vendor }, // Copy vendor data
    remainingProducts: allOrderProducts.filter(order => 
      !(order.claimed_by === vendor.warehouseId && order.status === 'claimed')
    ),
    originalOrder: { ...originalOrder }, // Copy original order data
    cloneOrderId,
    timestamp: new Date().toISOString() // Fixed timestamp for consistency
  };
  
  console.log('✅ Input data captured and frozen');
  return inputData;
}

// Generate unique clone order ID
async function generateUniqueCloneId(originalOrderId) {
    const database = require('../config/database');
  
  // Get ALL orders from database (no filters) for clone ID checking
  let allOrders;
  try {
    const [rows] = await database.mysqlConnection.execute(
      'SELECT order_id FROM orders'
    );
    allOrders = rows;
  } catch (dbError) {
    console.log('⚠️ Direct query failed, falling back to getAllOrders method');
    // Fallback: use getAllOrders but understand it might be filtered
    const orders = await database.getAllOrders();
    allOrders = orders;
  }
  
  let cloneOrderId = `${originalOrderId}_1`;
  let counter = 1;
  
  // Check if this clone already exists in MySQL (check ALL orders)
  while (allOrders.some(order => order.order_id === cloneOrderId)) {
    counter++;
    cloneOrderId = `${originalOrderId}_${counter}`;
  }
    
    // Additional check: Verify with Shipway API to ensure no conflicts
    try {
      const shipwayService = require('../services/shipwayService');
      const shipwayOrders = await shipwayService.fetchOrdersFromShipway();
      
      while (shipwayOrders.some(order => order.order_id === cloneOrderId)) {
        counter++;
        cloneOrderId = `${originalOrderId}_${counter}`;
      console.log(`  - Clone ID exists in Shipway, incrementing to ${cloneOrderId}`);
      }
    } catch (shipwayError) {
      console.log('  - Warning: Could not verify clone ID with Shipway:', shipwayError.message);
      console.log('  - Proceeding with MySQL-only check');
    }
    
  console.log(`  - Generated unique Clone Order ID: ${cloneOrderId}`);
  return cloneOrderId;
}

// Step 1: Create clone order (NO label generation)
async function createCloneOrderOnly(inputData) {
  const { cloneOrderId, claimedProducts, originalOrder, vendor } = inputData;
  
  console.log(`🔒 Creating clone with consistent data:`);
  console.log(`  - Clone ID: ${cloneOrderId}`);
  console.log(`  - Products count: ${claimedProducts.length}`);
  console.log(`  - Timestamp: ${inputData.timestamp}`);
  
  const requestBody = prepareShipwayRequestBody(
    cloneOrderId, 
    claimedProducts, 
    originalOrder, 
    vendor, 
    false // NO label generation
  );
  
  const response = await callShipwayPushOrderAPI(requestBody, false);
  
  if (!response.success) {
    throw new Error(`Failed to create clone order: ${response.message || 'Unknown error'}`);
    }
    
    console.log('✅ Clone order created successfully in Shipway');
  return response;
}

// Step 2: Verify clone exists
async function verifyCloneExists(inputData) {
  const { cloneOrderId } = inputData;
  
  console.log(`🔒 Verifying clone exists with consistent data:`);
  console.log(`  - Clone ID: ${cloneOrderId}`);
  console.log(`  - Timestamp: ${inputData.timestamp}`);
  
  // Call Shipway API to verify clone order exists
  const shipwayService = require('../services/shipwayService');
  const shipwayOrders = await shipwayService.fetchOrdersFromShipway();
  
  const cloneExists = shipwayOrders.some(order => order.order_id === cloneOrderId);
  
  if (!cloneExists) {
    throw new Error(`Clone order ${cloneOrderId} not found in Shipway`);
  }
  
  console.log('✅ Clone order verified in Shipway');
  return { success: true, verified: true };
}

// Step 3: Update original order
async function updateOriginalOrder(inputData) {
  const { originalOrderId, remainingProducts, originalOrder, vendor } = inputData;
  
  console.log(`🔒 Updating original with consistent data:`);
  console.log(`  - Original ID: ${originalOrderId}`);
  console.log(`  - Remaining products: ${remainingProducts.length}`);
  console.log(`  - Timestamp: ${inputData.timestamp}`);
    
    if (remainingProducts.length > 0) {
    const requestBody = prepareShipwayRequestBody(
      originalOrderId,
      remainingProducts,
      originalOrder,
      vendor,
      false // NO label generation
    );
    
    const response = await callShipwayPushOrderAPI(requestBody, false);
    
    if (!response.success) {
      throw new Error(`Failed to update original order: ${response.message || 'Unknown error'}`);
    }
    
    console.log('✅ Original order updated successfully in Shipway');
    return response;
    } else {
    console.log('ℹ️ No remaining products - original order will be empty');
    return { success: true, message: 'No remaining products to update' };
  }
}

// Step 4: Verify original order update
async function verifyOriginalOrderUpdate(inputData) {
  const { originalOrderId, remainingProducts } = inputData;
  
  console.log(`🔒 Verifying original order update with consistent data:`);
  console.log(`  - Original ID: ${originalOrderId}`);
  console.log(`  - Expected remaining products: ${remainingProducts.length}`);
  console.log(`  - Timestamp: ${inputData.timestamp}`);
  
  // Call Shipway API to verify original order was updated correctly
  const shipwayService = require('../services/shipwayService');
  const shipwayOrders = await shipwayService.fetchOrdersFromShipway();
  
  const originalOrder = shipwayOrders.find(order => order.order_id === originalOrderId);
  
  if (!originalOrder && remainingProducts.length > 0) {
    throw new Error(`Original order ${originalOrderId} not found in Shipway after update`);
  }
  
  console.log('✅ Original order update verified in Shipway');
  return { success: true, verified: true };
}

// Step 5: Update local database after clone creation
async function updateLocalDatabaseAfterClone(inputData) {
  const { claimedProducts, cloneOrderId, originalOrderId } = inputData;
  const database = require('../config/database');
  
  console.log(`🔒 Updating local database with consistent data:`);
  console.log(`  - Claimed products: ${claimedProducts.length}`);
  console.log(`  - Clone Order ID: ${cloneOrderId}`);
  console.log(`  - Original Order ID: ${originalOrderId}`);
  console.log(`  - Setting label_downloaded = 0 (not downloaded yet)`);
  
    for (const product of claimedProducts) {
      // Update orders table: set order_id to clone ID
      await database.updateOrder(product.unique_id, {
        order_id: cloneOrderId  // ✅ Update orders table with clone ID
      });
      
      // Update claims table: set claim-specific fields
      await database.updateOrder(product.unique_id, {
        order_id: cloneOrderId,           // ✅ Set to clone order ID
        clone_status: 'cloned',           // ✅ Mark as cloned
        cloned_order_id: originalOrderId, // ✅ Store original order ID (not clone ID)
        label_downloaded: 0               // ✅ Initially 0 (not downloaded)
      });
      
      console.log(`  ✅ Updated product ${product.unique_id} after clone creation:`);
      console.log(`     - orders.order_id: ${cloneOrderId}`);
      console.log(`     - claims.order_id: ${cloneOrderId}`);
      console.log(`     - clone_status: cloned`);
      console.log(`     - cloned_order_id: ${originalOrderId}`);
      console.log(`     - label_downloaded: 0`);
    }
  
  console.log('✅ Local database updated after clone creation');
  return { success: true, updatedProducts: claimedProducts.length };
}

// Step 6: Generate label for clone
async function generateLabelForClone(inputData) {
  const { cloneOrderId, claimedProducts, vendor } = inputData;
  
  console.log(`🔒 Generating label with consistent data:`);
  console.log(`  - Clone ID: ${cloneOrderId}`);
  console.log(`  - Products for label: ${claimedProducts.length}`);
  console.log(`  - Timestamp: ${inputData.timestamp}`);
  
  // Generate label for the clone order
  const labelResponse = await generateLabelForOrder(cloneOrderId, claimedProducts, vendor);
  
  if (!labelResponse.success) {
    throw new Error(`Failed to generate label for clone: ${labelResponse.message || 'Unknown error'}`);
  }
  
  console.log('✅ Label generated successfully for clone order');
  return labelResponse;
}

// Step 7: Mark label as downloaded and store in labels table
async function markLabelAsDownloaded(inputData, labelResponse) {
  const { claimedProducts, cloneOrderId } = inputData;
  const database = require('../config/database');
  
  console.log(`🔒 Marking label as downloaded and storing in labels table:`);
  console.log(`  - Clone Order ID: ${cloneOrderId}`);
  console.log(`  - Products count: ${claimedProducts.length}`);
  console.log(`  - Label URL: ${labelResponse.data.shipping_url}`);
  console.log(`  - AWB: ${labelResponse.data.awb}`);
  
  // Update orders table: mark label as downloaded
  for (const product of claimedProducts) {
    await database.updateOrder(product.unique_id, {
      label_downloaded: 1  // ✅ Mark as downloaded only after successful label generation
    });
    
    console.log(`  ✅ Marked product ${product.unique_id} label as downloaded`);
  }
  
  // Store label URL and carrier info in labels table (one entry per order_id, no duplicates)
  if (labelResponse.data.shipping_url) {
    const labelDataToStore = {
      order_id: cloneOrderId,
      label_url: labelResponse.data.shipping_url,
      awb: labelResponse.data.awb,
      carrier_id: labelResponse.data.carrier_id,
      carrier_name: labelResponse.data.carrier_name,
      priority_carrier: labelResponse.data.carrier_id
    };
    
    console.log(`📦 Storing label data for clone order:`, labelDataToStore);
    
    await database.upsertLabel(labelDataToStore);
    
    console.log(`  ✅ Stored label and carrier info in labels table for order ${cloneOrderId}`);
    console.log(`  - Carrier: ${labelResponse.data.carrier_id} (${labelResponse.data.carrier_name})`);
  } else {
    console.log(`  ⚠️ No shipping URL found in label response, skipping labels table storage`);
  }
  
  console.log('✅ All product labels marked as downloaded and cached');
  return { success: true, markedProducts: claimedProducts.length };
}

/**
 * Prepare request body for Shipway API
 */
function prepareShipwayRequestBody(orderId, products, originalOrder, vendor, generateLabel = false) {
  // Get payment type from the first product (all products in an order should have same payment_type)
  const paymentType = products[0]?.payment_type || 'P';
  console.log('🔍 Payment type from order data:', paymentType);
  
  const orderTotal = products.reduce((sum, product) => {
    if (paymentType === 'C') {
      return sum + (parseFloat(product.collectable_amount) || 0);
    } else {
      return sum + (parseFloat(product.order_total_split) || 0);
    }
  }, 0);
  
  // Calculate order weight
  const orderWeight = 350 * products.length;
  
  // Prepare products array
  const shipwayProducts = products.map(product => ({
    product: product.product_name,
    price: product.selling_price,
    product_code: product.product_code,
    product_quantity: "1",
    discount: "0",
    tax_rate: "5",
    tax_title: "IGST"
  }));
  
  // Prepare order tags
  const orderTags = paymentType === 'C' ? ["PPCOD"] : ["P"];
  
  // Base request body (common for both APIs)
  const baseRequestBody = {
    order_id: orderId,
    ewaybill: "",
    store_code: "1",
    products: shipwayProducts,
    discount: "0",
    shipping: "0",
    order_total: orderTotal.toString(),
    gift_card_amt: "0",
    taxes: "0",
    payment_type: paymentType,
    email: originalOrder.email,
    billing_address: originalOrder.b_address,
    billing_address2: originalOrder.b_address_2 || "",
    billing_city: originalOrder.b_city,
    billing_state: originalOrder.b_state,
    billing_country: originalOrder.b_country,
    billing_firstname: originalOrder.b_firstname,
    billing_lastname: originalOrder.b_lastname,
    billing_phone: originalOrder.b_phone,
    billing_zipcode: originalOrder.b_zipcode,
    billing_latitude: "10",
    billing_longitude: "20",
    shipping_address: originalOrder.s_address,
    shipping_address2: originalOrder.s_address_2 || "",
    shipping_city: originalOrder.s_city,
    shipping_state: originalOrder.s_state,
    shipping_country: originalOrder.s_country,
    shipping_firstname: originalOrder.s_firstname,
    shipping_lastname: originalOrder.s_lastname,
    shipping_phone: originalOrder.s_phone,
    shipping_zipcode: originalOrder.s_zipcode,
    shipping_latitude: "10",
    shipping_longitude: "20",
    order_weight: orderWeight.toString(),
    box_length: "20",
    box_breadth: "22",
    box_height: "3",
    order_date: originalOrder.order_date,
    order_tags: orderTags
  };
  
  // Add label generation specific parameters only for new orders
  if (generateLabel) {
    console.log('🔄 Adding label generation parameters (carrier_id, warehouse_id, return_warehouse_id)');
    baseRequestBody.carrier_id = parseInt(products[0].priority_carrier) || 80165;
    baseRequestBody.warehouse_id = vendor.warehouseId;
    baseRequestBody.return_warehouse_id = '67311'; // Try 67311 first, fallback to vendor's warehouse if needed
    baseRequestBody.generate_label = true;
  } else {
    console.log('🔄 Using PUSH Order API (no carrier/warehouse parameters)');
  }
  
  return baseRequestBody;
}

/**
 * Call Shipway Create Manifest API
 */
async function callShipwayCreateManifestAPI(orderIds) {
  try {
    console.log('🔄 Calling Shipway Create Manifest API');
    console.log('  - Order IDs:', Array.isArray(orderIds) ? orderIds : [orderIds]);
    
    // Get basic auth credentials from environment
    const username = process.env.SHIPWAY_USERNAME;
    const password = process.env.SHIPWAY_PASSWORD;
    const basicAuthHeader = process.env.SHIPWAY_BASIC_AUTH_HEADER;
    
    console.log('🔍 Debug: Environment variables check');
    console.log('  - SHIPWAY_USERNAME:', username ? 'SET' : 'NOT SET');
    console.log('  - SHIPWAY_PASSWORD:', password ? 'SET' : 'NOT SET');
    console.log('  - SHIPWAY_BASIC_AUTH_HEADER:', basicAuthHeader ? 'SET' : 'NOT SET');
    
    let authHeader;
    if (basicAuthHeader) {
      authHeader = basicAuthHeader;
      console.log('✅ Using SHIPWAY_BASIC_AUTH_HEADER');
    } else if (username && password) {
      authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      console.log('✅ Using SHIPWAY_USERNAME and SHIPWAY_PASSWORD');
    } else {
      console.log('❌ No Shipway credentials found');
      throw new Error('Shipway credentials not configured');
    }
    
    const requestBody = {
      order_ids: Array.isArray(orderIds) ? orderIds : [orderIds]
    };
    
    console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch('https://app.shipway.com/api/Createmanifest/', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    console.log('📥 Response status:', response.status);
    console.log('📥 Response data:', JSON.stringify(data, null, 2));
    
    if (!response.ok) {
      throw new Error(`Shipway Create Manifest API error: ${data.message || response.statusText}`);
    }
    
    console.log('✅ Shipway Create Manifest API call successful');
    return {
      success: true,
      data: data
    };
    
  } catch (error) {
    console.error('❌ Shipway Create Manifest API call failed:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Call Shipway PUSH Order API
 */
async function callShipwayPushOrderAPI(requestBody, generateLabel = false) {
  try {
    console.log('🔄 Calling Shipway PUSH Order API');
    console.log('  - Generate label:', generateLabel);
    console.log('  - Order ID:', requestBody.order_id);
    console.log('  - API Type:', generateLabel ? 'PUSH Order with Label Generation' : 'PUSH Order (Edit Only)');
    
    // Get basic auth credentials from environment
    const username = process.env.SHIPWAY_USERNAME;
    const password = process.env.SHIPWAY_PASSWORD;
    const basicAuthHeader = process.env.SHIPWAY_BASIC_AUTH_HEADER;
    
    console.log('🔍 Debug: Environment variables check');
    console.log('  - SHIPWAY_USERNAME:', username ? 'SET' : 'NOT SET');
    console.log('  - SHIPWAY_PASSWORD:', password ? 'SET' : 'NOT SET');
    console.log('  - SHIPWAY_BASIC_AUTH_HEADER:', basicAuthHeader ? 'SET' : 'NOT SET');
    
    let authHeader;
    if (basicAuthHeader) {
      authHeader = basicAuthHeader;
      console.log('✅ Using SHIPWAY_BASIC_AUTH_HEADER');
    } else if (username && password) {
      authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      console.log('✅ Using SHIPWAY_USERNAME and SHIPWAY_PASSWORD');
    } else {
      console.log('❌ No Shipway credentials found');
      throw new Error('Shipway credentials not configured');
    }
    
    // For original order editing (no label generation), remove generate_label parameter
    let apiRequestBody = { ...requestBody };
    if (!generateLabel) {
      console.log('🔄 Removing generate_label parameter for order edit');
      delete apiRequestBody.generate_label;
    }
    
    const response = await fetch('https://app.shipway.com/api/v2orders', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(apiRequestBody)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`Shipway API error: ${data.message || response.statusText}`);
    }
    
    console.log('✅ Shipway API call successful');
    return data;
    
  } catch (error) {
    console.error('❌ Shipway API call failed:', error);
    throw error;
  }
}

/**
 * Sync orders from Shipway
 */
async function syncOrdersFromShipway() {
  try {
    console.log('🔄 Syncing orders from Shipway');
    
    // Import the shipway service (it's already an instance)
    const shipwayService = require('../services/shipwayService');
    
    // Call the sync method
    await shipwayService.syncOrdersToMySQL();
    
    console.log('✅ Orders synced successfully');
    
  } catch (error) {
    console.error('❌ Order sync failed:', error);
    throw error;
  }
}

/**
 * @route   POST /api/orders/bulk-download-labels
 * @desc    Download labels for multiple orders and merge into single PDF
 * @access  Vendor (token required)
 */
router.post('/bulk-download-labels', async (req, res) => {
  const { order_ids } = req.body;
  const token = req.headers['authorization'];
  
  console.log('🔵 BULK DOWNLOAD LABELS REQUEST START');
  console.log('  - order_ids:', order_ids);
  console.log('  - token received:', token ? 'YES' : 'NO');
  
  if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0 || !token) {
    console.log('❌ BULK DOWNLOAD LABELS FAILED: Missing required fields');
    return res.status(400).json({ 
      success: false, 
      message: 'order_ids array and Authorization token required' 
    });
  }

  try {
    // Load users from MySQL to get vendor info
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('❌ VENDOR NOT FOUND OR INACTIVE ', vendor);
      return res.status(401).json({ success: false, message: 'Invalid or inactive vendor token' });
    }

    console.log('✅ VENDOR FOUND:');
    console.log('  - Email:', vendor.email);
    console.log('  - Warehouse ID:', vendor.warehouseId);

    // Get orders from MySQL
    const orders = await database.getAllOrders();

    const results = [];
    const errors = [];

    // Process each order ID
    for (const orderId of order_ids) {
      try {
        console.log(`🔄 Processing order: ${orderId}`);
        
        // Check if this is already a clone order
        const isCloneOrder = orderId.includes('_');
        
        // Get all products for this order_id
        const orderProducts = orders.filter(order => order.order_id === orderId);
        const claimedProducts = orderProducts.filter(order => 
          order.claimed_by === vendor.warehouseId && order.status === 'claimed'
        );

        if (claimedProducts.length === 0) {
          errors.push({
            order_id: orderId,
            error: 'No products claimed by this vendor for this order'
          });
          continue;
        }

        // ✅ OPTIMIZATION: Check if label already downloaded
        const firstClaimedProduct = claimedProducts[0];
        if (firstClaimedProduct.label_downloaded === 1) {
          console.log(`⚡ BULK: Label already downloaded for ${orderId}, fetching from cache...`);
          
          // Get existing label from labels table
          const existingLabel = await database.getLabelByOrderId(orderId);
          if (existingLabel && existingLabel.label_url) {
            console.log(`✅ BULK: Found cached label for ${orderId}`);
            results.push({
              order_id: orderId,
              shipping_url: existingLabel.label_url,
              awb: existingLabel.awb || 'N/A'
            });
            continue; // Skip to next order
          } else {
            console.log(`⚠️ BULK: label_downloaded=1 but no cached label found for ${orderId}, generating new one...`);
          }
        }

        let labelResponse;
        if (isCloneOrder) {
          // Already a clone order - direct download
          console.log(`📋 BULK: Processing clone order ${orderId}`);
          labelResponse = await generateLabelForOrder(orderId, claimedProducts, vendor);
          
          // Store label and carrier info for clone order
          if (labelResponse.success && labelResponse.data.shipping_url) {
            await database.upsertLabel({
              order_id: orderId,
              label_url: labelResponse.data.shipping_url,
              awb: labelResponse.data.awb,
              carrier_id: labelResponse.data.carrier_id,
              carrier_name: labelResponse.data.carrier_name,
              priority_carrier: labelResponse.data.carrier_id
            });
            console.log(`✅ BULK: Stored label data for clone order ${orderId}`);
            
            // ✅ Mark label as downloaded in claims table for all claimed products
            for (const product of claimedProducts) {
              await database.updateOrder(product.unique_id, {
                label_downloaded: 1  // Mark as downloaded after successful label generation
              });
              console.log(`  ✅ BULK: Marked product ${product.unique_id} label as downloaded`);
            }
          }
        } else if (orderProducts.length === claimedProducts.length) {
          // Direct download - all products claimed by vendor
          console.log(`📋 BULK: Processing direct download for ${orderId}`);
          labelResponse = await generateLabelForOrder(orderId, claimedProducts, vendor);
          
          // Store label and carrier info for direct download
          if (labelResponse.success && labelResponse.data.shipping_url) {
            await database.upsertLabel({
              order_id: orderId,
              label_url: labelResponse.data.shipping_url,
              awb: labelResponse.data.awb,
              carrier_id: labelResponse.data.carrier_id,
              carrier_name: labelResponse.data.carrier_name,
              priority_carrier: labelResponse.data.carrier_id
            });
            console.log(`✅ BULK: Stored label data for direct download ${orderId}`);
            
            // ✅ Mark label as downloaded in claims table for all claimed products
            for (const product of claimedProducts) {
              await database.updateOrder(product.unique_id, {
                label_downloaded: 1  // Mark as downloaded after successful label generation
              });
              console.log(`  ✅ BULK: Marked product ${product.unique_id} label as downloaded`);
            }
          }
        } else if (claimedProducts.length > 0) {
          // Clone required - some products claimed by vendor
          console.log(`📋 BULK: Processing clone creation for ${orderId}`);
          labelResponse = await handleOrderCloning(orderId, claimedProducts, orderProducts, vendor);
          // Note: handleOrderCloning already stores labels via markLabelAsDownloaded
        } else {
          errors.push({
            order_id: orderId,
            error: 'No products claimed by this vendor for this order'
          });
          continue;
        }

        if (labelResponse.success) {
          results.push({
            order_id: orderId,
            shipping_url: labelResponse.data.shipping_url,
            awb: labelResponse.data.awb
          });
        } else {
          errors.push({
            order_id: orderId,
            error: labelResponse.message || 'Label generation failed'
          });
        }

      } catch (error) {
        console.error(`❌ Error processing order ${orderId}:`, error);
        errors.push({
          order_id: orderId,
          error: error.message
        });
      }
    }

    console.log('📊 BULK DOWNLOAD LABELS COMPLETE:');
    console.log('  - Successful:', results.length);
    console.log('  - Failed:', errors.length);

    if (results.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No labels could be generated for any of the selected orders',
        data: { errors }
      });
    }

    // Generate combined PDF
    try {
      const combinedPdfBuffer = await generateCombinedLabelsPDF(results);
      
      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="bulk-labels-${Date.now()}.pdf"`);
      res.setHeader('Content-Length', combinedPdfBuffer.length);
      
      // Send the PDF buffer
      res.send(combinedPdfBuffer);
      
    } catch (pdfError) {
      console.error('❌ PDF generation failed:', pdfError);
      
      // Fallback: return individual label URLs
      return res.json({
        success: true,
        message: 'Labels generated but PDF combination failed. Returning individual URLs.',
        data: {
          labels: results,
          errors,
          total_successful: results.length,
          total_failed: errors.length
        }
      });
    }

  } catch (error) {
    console.error('❌ BULK DOWNLOAD LABELS ERROR:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to process bulk label download', 
      error: error.message 
    });
  }
});

/**
 * @route   POST /api/orders/download-pdf
 * @desc    Proxy endpoint to download PDF from Shipway (avoids CORS issues)
 * @access  Vendor (token required)
 */
router.post('/download-pdf', async (req, res) => {
  const { pdfUrl } = req.body;
  const token = req.headers['authorization'];
  
  console.log('🔵 DOWNLOAD PDF PROXY REQUEST START');
  console.log('  - PDF URL:', pdfUrl);
  console.log('  - token received:', token ? 'YES' : 'NO');
  
  if (!pdfUrl || !token) {
    console.log('❌ DOWNLOAD PDF PROXY FAILED: Missing required fields');
    return res.status(400).json({ 
      success: false, 
      message: 'pdfUrl and Authorization token required' 
    });
  }

  try {
    // Load users from MySQL to get vendor info
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('❌ VENDOR NOT FOUND OR INACTIVE ', vendor);
      return res.status(401).json({ success: false, message: 'Invalid or inactive vendor token' });
    }

    console.log('✅ VENDOR FOUND:');
    console.log('  - Email:', vendor.email);
    console.log('  - Warehouse ID:', vendor.warehouseId);

    // Fetch PDF from Shipway
    console.log('🔄 Fetching PDF from Shipway...');
    const response = await fetch(pdfUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }
    
    const pdfBuffer = await response.arrayBuffer();
    
    // Validate that we received a valid buffer
    if (!pdfBuffer || pdfBuffer.byteLength === 0) {
      throw new Error('Received empty or invalid PDF buffer');
    }
    
    console.log('✅ PDF fetched successfully');
    console.log('  - Size:', pdfBuffer.byteLength, 'bytes');
    
    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="label.pdf"');
    res.setHeader('Content-Length', pdfBuffer.byteLength);
    
    // Send the PDF buffer
    res.send(Buffer.from(pdfBuffer));
    
  } catch (error) {
    console.error('❌ DOWNLOAD PDF PROXY ERROR:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to download PDF', 
      error: error.message 
    });
  }
});

/**
 * Generate combined PDF from multiple label URLs
 */
async function generateCombinedLabelsPDF(labels) {
  try {
    console.log('🔄 Generating combined PDF for', labels.length, 'labels');
    
    // Import PDF-lib for PDF manipulation
    const { PDFDocument } = require('pdf-lib');
    
    // Create a new PDF document
    const mergedPdf = await PDFDocument.create();
    
    // Process each label
    for (const label of labels) {
      try {
        console.log(`  - Processing label for order ${label.order_id}`);
        
        // Fetch the PDF from the shipping URL
        const response = await fetch(label.shipping_url);
        if (!response.ok) {
          console.log(`    ⚠️ Failed to fetch label for order ${label.order_id}:`, response.status);
          continue;
        }
        
        const pdfBuffer = await response.arrayBuffer();
        
        // Load the PDF
        const pdf = await PDFDocument.load(pdfBuffer);
        
        // Copy all pages from this PDF to the merged PDF
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
        
        console.log(`    ✅ Added label for order ${label.order_id}`);
        
      } catch (labelError) {
        console.log(`    ❌ Error processing label for order ${label.order_id}:`, labelError.message);
      }
    }
    
    // Save the merged PDF
    const mergedPdfBytes = await mergedPdf.save();
    console.log('✅ Combined PDF generated successfully');
    
    return Buffer.from(mergedPdfBytes);
    
  } catch (error) {
    console.error('❌ Combined PDF generation failed:', error);
    throw error;
  }
}

/**
 * @route   POST /api/orders/mark-ready
 * @desc    Mark order as ready for handover by calling Shipway manifest API
 * @access  Vendor (token required)
 */
router.post('/mark-ready', async (req, res) => {
  const { order_id } = req.body;
  const token = req.headers['authorization'];
  
  console.log('🔵 MARK READY REQUEST START');
  console.log('  - order_id:', order_id);
  console.log('  - token received:', token ? 'YES' : 'NO');
  
  if (!order_id || !token) {
    console.log('❌ MARK READY FAILED: Missing required fields');
    return res.status(400).json({ 
      success: false, 
      message: 'order_id and Authorization token required' 
    });
  }

  try {
    // Load users from MySQL to get vendor info
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('❌ VENDOR NOT FOUND OR INACTIVE ', vendor);
      return res.status(401).json({ success: false, message: 'Invalid or inactive vendor token' });
    }

    console.log('✅ VENDOR FOUND:');
    console.log('  - Email:', vendor.email);
    console.log('  - Warehouse ID:', vendor.warehouseId);

    // Get orders from MySQL to verify the order belongs to this vendor
    const orders = await database.getAllOrders();
    const orderProducts = orders.filter(order => order.order_id === order_id);
    const claimedProducts = orderProducts.filter(order => 
      order.claimed_by === vendor.warehouseId && order.status === 'claimed'
    );

    if (claimedProducts.length === 0) {
      console.log('❌ No products claimed by this vendor for order:', order_id);
      return res.status(400).json({ 
        success: false, 
        message: 'No products claimed by this vendor for this order' 
      });
    }

    // Check if label is downloaded for all claimed products
    const productsWithoutLabel = claimedProducts.filter(product => product.label_downloaded !== 1);
    if (productsWithoutLabel.length > 0) {
      console.log(`❌ Label not downloaded for order: ${order_id}`);
      return res.status(400).json({ 
        success: false, 
        message: `Label is not yet downloaded for order id - ${order_id}` 
      });
    }

    console.log('✅ Order verification passed');
    console.log('  - Total products in order:', orderProducts.length);
    console.log('  - Products claimed by vendor:', claimedProducts.length);

    // Call Shipway Create Manifest API
    console.log('🔄 Calling Shipway Create Manifest API...');
    const manifestResponse = await callShipwayCreateManifestAPI(order_id);
    
    if (!manifestResponse.success) {
      console.log('❌ Shipway manifest API failed:', manifestResponse.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to create manifest: ' + manifestResponse.message
      });
    }

    console.log('✅ Shipway manifest API successful');

    // Set is_manifest = 1 in labels table first
    console.log('🔄 Setting is_manifest = 1 in labels table...');
    const labelData = {
      order_id: order_id,
      is_manifest: 1
    };
    
    await database.upsertLabel(labelData);
    console.log(`  ✅ Set is_manifest = 1 for order ${order_id}`);

    // Update order status to ready_for_handover after setting is_manifest
    console.log('🔄 Updating order status to ready_for_handover...');
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    for (const product of claimedProducts) {
      await database.updateOrder(product.unique_id, {
        status: 'ready_for_handover'
      });
      console.log(`  ✅ Updated product ${product.unique_id} status to ready_for_handover`);
    }

    console.log('🟢 MARK READY SUCCESS');
    console.log(`  - Order ${order_id} marked as ready for handover`);
    console.log(`  - Manifest created successfully`);
    console.log(`  - is_manifest flag set to 1`);

    return res.json({
      success: true,
      message: 'Order marked as ready for handover successfully',
      data: {
        order_id: order_id,
        status: 'ready_for_handover',
        manifest_created: true,
        is_manifest: 1
      }
    });

  } catch (error) {
    console.error('❌ MARK READY ERROR:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to mark order as ready', 
      error: error.message 
    });
  }
});

/**
 * @route   POST /api/orders/bulk-mark-ready
 * @desc    Mark multiple orders as ready for handover by calling Shipway manifest API
 * @access  Vendor (token required)
 */
router.post('/bulk-mark-ready', async (req, res) => {
  const { order_ids } = req.body;
  const token = req.headers['authorization'];
  
  console.log('🔵 BULK MARK READY REQUEST START');
  console.log('  - order_ids:', order_ids);
  console.log('  - token received:', token ? 'YES' : 'NO');
  
  if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0 || !token) {
    console.log('❌ BULK MARK READY FAILED: Missing required fields');
    return res.status(400).json({ 
      success: false, 
      message: 'order_ids array and Authorization token required' 
    });
  }

  try {
    // Load users from MySQL to get vendor info
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('❌ VENDOR NOT FOUND OR INACTIVE ', vendor);
      return res.status(401).json({ success: false, message: 'Invalid or inactive vendor token' });
    }

    console.log('✅ VENDOR FOUND:');
    console.log('  - Email:', vendor.email);
    console.log('  - Warehouse ID:', vendor.warehouseId);

    // Get orders from MySQL to verify all orders belong to this vendor
    const orders = await database.getAllOrders();
    const successfulOrders = [];
    const failedOrders = [];
    const validOrderIds = [];

    // First, validate all orders
    for (const order_id of order_ids) {
      try {
        console.log(`🔍 Validating order: ${order_id}`);
        
        const orderProducts = orders.filter(order => order.order_id === order_id);
        const claimedProducts = orderProducts.filter(order => 
          order.claimed_by === vendor.warehouseId && order.status === 'claimed'
        );

        if (claimedProducts.length === 0) {
          console.log(`❌ No products claimed by this vendor for order: ${order_id}`);
          failedOrders.push({
            order_id: order_id,
            reason: 'No products claimed by this vendor for this order'
          });
          continue;
        }

        // Check if label is downloaded for all claimed products
        const productsWithoutLabel = claimedProducts.filter(product => product.label_downloaded !== 1);
        if (productsWithoutLabel.length > 0) {
          console.log(`❌ Label not downloaded for order: ${order_id}`);
          failedOrders.push({
            order_id: order_id,
            reason: `Label is not yet downloaded for order id - ${order_id}`
          });
          continue;
        }

        console.log(`✅ Order validation passed for ${order_id}`);
        validOrderIds.push(order_id);

      } catch (error) {
        console.error(`❌ Error validating order ${order_id}:`, error);
        failedOrders.push({
          order_id: order_id,
          reason: error.message
        });
      }
    }

    // If we have valid orders, call the bulk manifest API
    if (validOrderIds.length > 0) {
      console.log(`🔄 Calling Shipway Create Manifest API for ${validOrderIds.length} orders...`);
      console.log(`  - Valid order IDs: ${validOrderIds.join(', ')}`);
      
      const manifestResponse = await callShipwayCreateManifestAPI(validOrderIds);
      
      if (!manifestResponse.success) {
        console.log(`❌ Shipway bulk manifest API failed:`, manifestResponse.message);
        // Add all valid orders to failed list
        validOrderIds.forEach(order_id => {
          failedOrders.push({
            order_id: order_id,
            reason: 'Failed to create manifest: ' + manifestResponse.message
          });
        });
      } else {
        console.log(`✅ Shipway bulk manifest API successful for ${validOrderIds.length} orders`);

        // Process each valid order for database updates
        for (const order_id of validOrderIds) {
          try {
            const orderProducts = orders.filter(order => order.order_id === order_id);
            const claimedProducts = orderProducts.filter(order => 
              order.claimed_by === vendor.warehouseId && order.status === 'claimed'
            );

            // Set is_manifest = 1 in labels table first
            console.log(`🔄 Setting is_manifest = 1 in labels table for ${order_id}...`);
            const labelData = {
              order_id: order_id,
              is_manifest: 1
            };
            
            await database.upsertLabel(labelData);
            console.log(`  ✅ Set is_manifest = 1 for order ${order_id}`);

            // Update order status to ready_for_handover after setting is_manifest
            console.log(`🔄 Updating order status to ready_for_handover for ${order_id}...`);
            
            for (const product of claimedProducts) {
              await database.updateOrder(product.unique_id, {
                status: 'ready_for_handover'
              });
              console.log(`  ✅ Updated product ${product.unique_id} status to ready_for_handover`);
            }

            successfulOrders.push({
              order_id: order_id,
              status: 'ready_for_handover',
              manifest_created: true,
              is_manifest: 1
            });

          } catch (error) {
            console.error(`❌ Error updating order ${order_id}:`, error);
            failedOrders.push({
              order_id: order_id,
              reason: error.message
            });
          }
        }
      }
    }

    console.log('🟢 BULK MARK READY COMPLETE');
    console.log(`  - Successful orders: ${successfulOrders.length}`);
    console.log(`  - Failed orders: ${failedOrders.length}`);

    if (successfulOrders.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No orders could be marked as ready',
        data: {
          successful_orders: successfulOrders,
          failed_orders: failedOrders,
          total_requested: order_ids.length,
          total_successful: successfulOrders.length,
          total_failed: failedOrders.length
        }
      });
    }

    return res.json({
      success: true,
      message: `Successfully marked ${successfulOrders.length} out of ${order_ids.length} orders as ready for handover`,
      data: {
        successful_orders: successfulOrders,
        failed_orders: failedOrders,
        total_requested: order_ids.length,
        total_successful: successfulOrders.length,
        total_failed: failedOrders.length
      }
    });

  } catch (error) {
    console.error('❌ BULK MARK READY ERROR:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to mark orders as ready', 
      error: error.message 
    });
  }
});

/**
 * @route   POST /api/orders/refresh
 * @desc    Refresh orders by syncing from Shipway API
 * @access  Vendor (token required)
 */
router.post('/refresh', async (req, res) => {
  const token = req.headers['authorization'];
  
  console.log('🔵 REFRESH ORDERS REQUEST START');
  console.log('  - token received:', token ? 'YES' : 'NO');
  
  if (!token) {
    console.log('❌ REFRESH ORDERS FAILED: Missing token');
    return res.status(400).json({ success: false, message: 'Authorization token required' });
  }

  try {
    // Load users from MySQL to get vendor info
    const database = require('../config/database');
    
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return res.status(500).json({ success: false, message: 'Database connection not available' });
    }
    
    const vendor = await database.getUserByToken(token);
    
    if (!vendor || vendor.active_session !== 'TRUE') {
      console.log('❌ VENDOR NOT FOUND OR INACTIVE ', vendor);
      return res.status(401).json({ success: false, message: 'Invalid or inactive vendor token' });
    }

    console.log('✅ VENDOR FOUND:');
    console.log('  - Email:', vendor.email);
    console.log('  - Warehouse ID:', vendor.warehouseId);

    // Import shipwayService
    const shipwayService = require('../services/shipwayService');
    
    console.log('🔄 Starting orders sync from Shipway...');
    const result = await shipwayService.syncOrdersToMySQL();
    
    console.log('✅ Orders synced successfully');
    console.log('  - Result:', result);
    
    return res.json({
      success: true,
      message: 'Orders refreshed successfully from Shipway',
      data: {
        sync_result: result,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ REFRESH ORDERS ERROR:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to refresh orders', 
      error: error.message 
    });
  }
});

module.exports = router; 