/**
 * Database Migration: Create Notifications Table
 * 
 * This script creates a notifications table to track system alerts,
 * reverse order failures, shipment assignment errors, and other critical events.
 * 
 * Run: node backend/scripts/create-notifications-table.js
 */

// Load environment variables
require('dotenv').config();

const database = require('../config/database');

async function createNotificationsTable() {
  console.log('🚀 Starting notifications table creation...\n');

  try {
    // Step 1: Initialize MySQL connection
    console.log('1️⃣ Initializing MySQL connection...');
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return;
    }
    console.log('✅ MySQL connection established\n');

    // Step 2: Create notifications table
    console.log('2️⃣ Creating notifications table...');
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        
        -- Notification Core Info
        type ENUM(
          'reverse_order_failure',
          'shipment_assignment_error',
          'carrier_unavailable',
          'low_balance',
          'warehouse_issue',
          'payment_failed',
          'order_stuck',
          'other'
        ) NOT NULL,
        severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        
        -- Related Entity Info
        order_id VARCHAR(100),
        vendor_id VARCHAR(50),
        vendor_name VARCHAR(255),
        vendor_warehouse_id VARCHAR(50),
        
        -- Additional Context
        metadata JSON,
        error_details TEXT,
        
        -- Status Tracking
        status ENUM('pending', 'in_progress', 'resolved', 'dismissed') DEFAULT 'pending',
        
        -- Resolution Info
        resolved_by VARCHAR(50),
        resolved_by_name VARCHAR(255),
        resolved_at DATETIME,
        resolution_notes TEXT,
        
        -- Timestamps
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        -- Indexes for performance
        INDEX idx_type (type),
        INDEX idx_status (status),
        INDEX idx_vendor (vendor_id),
        INDEX idx_order (order_id),
        INDEX idx_created_at (created_at),
        INDEX idx_severity (severity),
        
        -- Foreign key constraints
        FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await database.mysqlConnection.execute(createTableQuery);
    console.log('✅ Notifications table created successfully!\n');

    // Step 3: Create notification_views table
    console.log('3️⃣ Creating notification_views table...');
    const createViewsTableQuery = `
      CREATE TABLE IF NOT EXISTS notification_views (
        id INT AUTO_INCREMENT PRIMARY KEY,
        notification_id INT NOT NULL,
        admin_id VARCHAR(50) NOT NULL,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE KEY unique_view (notification_id, admin_id),
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
        
        INDEX idx_notification (notification_id),
        INDEX idx_admin (admin_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await database.mysqlConnection.execute(createViewsTableQuery);
    console.log('✅ Notification views table created successfully!\n');

    // Step 4: Insert sample notifications for testing
    console.log('4️⃣ Inserting sample notifications...');
    const sampleNotifications = [
      {
        type: 'reverse_order_failure',
        severity: 'high',
        title: 'Reverse Order Failed - Order #12345',
        message: 'Vendor failed to process reverse order. Customer requested return but order status could not be updated.',
        order_id: '12345',
        vendor_id: null,
        vendor_name: 'Mumbai Warehouse',
        vendor_warehouse_id: '101',
        metadata: JSON.stringify({
          customer_name: 'John Doe',
          reason: 'Product damaged',
          attempted_at: new Date().toISOString()
        }),
        error_details: 'API timeout while connecting to Shipway. Error code: TIMEOUT_ERROR'
      },
      {
        type: 'shipment_assignment_error',
        severity: 'critical',
        title: 'No Carrier Available - Order #12346',
        message: 'Unable to assign carrier to order. No carriers available for the delivery pincode.',
        order_id: '12346',
        vendor_id: null,
        vendor_name: 'Delhi Warehouse',
        vendor_warehouse_id: '102',
        metadata: JSON.stringify({
          delivery_pincode: '110001',
          weight: '2.5kg',
          cod_amount: 1500
        }),
        error_details: 'No carriers serviceable for pincode 110001. Attempted carriers: BlueDart, Delhivery, DTDC'
      },
      {
        type: 'low_balance',
        severity: 'critical',
        title: 'Low Shipway Balance Alert',
        message: 'Shipway account balance is critically low. Unable to create new shipments.',
        metadata: JSON.stringify({
          current_balance: 150.50,
          threshold: 1000,
          pending_orders: 45
        }),
        error_details: 'Balance check returned: INR 150.50. Minimum required: INR 1000'
      },
      {
        type: 'carrier_unavailable',
        severity: 'medium',
        title: 'Carrier Service Down - Order #12347',
        message: 'Primary carrier service is temporarily unavailable. Order assignment delayed.',
        order_id: '12347',
        vendor_id: null,
        vendor_name: 'Bangalore Warehouse',
        vendor_warehouse_id: '103',
        metadata: JSON.stringify({
          carrier_name: 'BlueDart',
          retry_count: 3,
          next_retry: new Date(Date.now() + 30 * 60000).toISOString()
        }),
        error_details: 'Carrier API returned 503 Service Unavailable. Will retry in 30 minutes.'
      }
    ];

    let insertedCount = 0;
    for (const notification of sampleNotifications) {
      await database.mysqlConnection.execute(
        `INSERT INTO notifications 
        (type, severity, title, message, order_id, vendor_id, vendor_name, vendor_warehouse_id, metadata, error_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          notification.type,
          notification.severity,
          notification.title,
          notification.message,
          notification.order_id || null,
          notification.vendor_id || null,
          notification.vendor_name || null,
          notification.vendor_warehouse_id || null,
          notification.metadata || null,
          notification.error_details || null
        ]
      );
      insertedCount++;
      console.log(`  ✅ Inserted: ${notification.title}`);
    }

    console.log(`\n✅ ${insertedCount} sample notifications inserted successfully!\n`);

    // Step 5: Show table structure
    console.log('5️⃣ Verifying table structure...');
    const [tableInfo] = await database.mysqlConnection.execute('DESCRIBE notifications');
    console.log('\n📊 Notifications Table Structure:');
    console.table(tableInfo);

    // Step 6: Count notifications
    const [countResult] = await database.mysqlConnection.execute('SELECT COUNT(*) as total FROM notifications');
    console.log(`\n📈 Total notifications in database: ${countResult[0].total}`);

    console.log('\n✨ Migration completed successfully!');
    console.log('\n📝 Next Steps:');
    console.log('1. ✅ Database tables created');
    console.log('2. ✅ Backend API ready (/api/notifications)');
    console.log('3. ✅ Frontend notification tab added');
    console.log('4. 🔄 Refresh admin panel to see the Notifications tab');
    console.log('5. 🔄 Integrate notification creation from vendor panel');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating notifications table:', error);
    process.exit(1);
  }
}

// Run migration
createNotificationsTable();

