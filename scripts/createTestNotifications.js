/**
 * Script to create test notifications for testing the admin panel
 * Run: node scripts/createTestNotifications.js
 */

const database = require('../config/database');

const testNotifications = [
  {
    type: 'reverse_order_failure',
    severity: 'critical',
    title: 'Reverse Order Failed - ORD123456',
    message: 'Failed to create reverse order for order ORD123456. Shipway API returned error: Invalid warehouse credentials.',
    order_id: 'ORD123456',
    vendor_id: 'vendor_123',
    vendor_name: 'Test Vendor 1',
    vendor_warehouse_id: 'WH001',
    error_details: 'Shipway API Error: 401 - Unauthorized. Please verify warehouse credentials.',
    metadata: {
      attempt_count: 3,
      last_attempt: '2025-01-15T10:30:00Z',
      error_code: 'SHIPWAY_AUTH_FAILED'
    }
  },
  {
    type: 'carrier_unavailable',
    severity: 'high',
    title: 'No Carrier Available for Pincode 400001',
    message: 'Unable to assign carrier for order ORD789012. No carriers available for pincode 400001.',
    order_id: 'ORD789012',
    vendor_id: 'vendor_456',
    vendor_name: 'Test Vendor 2',
    vendor_warehouse_id: 'WH002',
    metadata: {
      pincode: '400001',
      weight: 2.5,
      attempted_carriers: ['DTDC', 'Delhivery', 'BlueDart']
    }
  },
  {
    type: 'shipment_assignment_error',
    severity: 'medium',
    title: 'Shipment Assignment Failed',
    message: 'Failed to assign shipment for order ORD345678. Carrier API timeout.',
    order_id: 'ORD345678',
    vendor_id: 'vendor_789',
    vendor_name: 'Test Vendor 3',
    vendor_warehouse_id: 'WH003',
    error_details: 'Carrier API timeout after 30 seconds. Please retry.',
    metadata: {
      carrier: 'DTDC',
      timeout_duration: 30000
    }
  },
  {
    type: 'low_balance',
    severity: 'high',
    title: 'Low Balance Alert - Vendor Account',
    message: 'Vendor account balance is running low. Current balance: ₹250. Please recharge to continue operations.',
    vendor_id: 'vendor_456',
    vendor_name: 'Test Vendor 2',
    vendor_warehouse_id: 'WH002',
    metadata: {
      current_balance: 250,
      threshold: 500,
      currency: 'INR'
    }
  },
  {
    type: 'warehouse_issue',
    severity: 'critical',
    title: 'Warehouse Credentials Invalid',
    message: 'Warehouse WH001 credentials are invalid or expired. Unable to process orders.',
    vendor_id: 'vendor_123',
    vendor_name: 'Test Vendor 1',
    vendor_warehouse_id: 'WH001',
    error_details: 'Shipway API returned 401 Unauthorized for warehouse WH001',
    metadata: {
      warehouse_status: 'inactive',
      last_verified: '2025-01-10T08:00:00Z'
    }
  },
  {
    type: 'order_stuck',
    severity: 'medium',
    title: 'Order Stuck in Processing',
    message: 'Order ORD567890 has been in \'Processing\' status for over 24 hours.',
    order_id: 'ORD567890',
    vendor_id: 'vendor_789',
    vendor_name: 'Test Vendor 3',
    vendor_warehouse_id: 'WH003',
    metadata: {
      stuck_duration_hours: 28,
      current_status: 'processing',
      last_updated: '2025-01-14T10:00:00Z'
    }
  },
  {
    type: 'payment_failed',
    severity: 'high',
    title: 'Payment Gateway Error',
    message: 'Payment collection failed for COD order ORD234567. Gateway returned error.',
    order_id: 'ORD234567',
    vendor_id: 'vendor_456',
    vendor_name: 'Test Vendor 2',
    vendor_warehouse_id: 'WH002',
    error_details: 'Payment gateway timeout - Transaction ID: TXN789456',
    metadata: {
      transaction_id: 'TXN789456',
      amount: 1250,
      payment_method: 'COD'
    }
  },
  {
    type: 'other',
    severity: 'low',
    title: 'System Maintenance Scheduled',
    message: 'System maintenance scheduled for Jan 20, 2025 from 2:00 AM to 4:00 AM IST.',
    metadata: {
      maintenance_start: '2025-01-20T02:00:00Z',
      maintenance_end: '2025-01-20T04:00:00Z',
      impact: 'Order processing will be temporarily paused'
    }
  }
];

async function createTestNotifications() {
  try {
    console.log('🔄 Creating test notifications...\n');

    for (const notification of testNotifications) {
      const query = `
        INSERT INTO notifications 
        (type, severity, title, message, order_id, vendor_id, vendor_name, vendor_warehouse_id, metadata, error_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await database.query(query, [
        notification.type,
        notification.severity,
        notification.title,
        notification.message,
        notification.order_id || null,
        notification.vendor_id || null,
        notification.vendor_name || null,
        notification.vendor_warehouse_id || null,
        notification.metadata ? JSON.stringify(notification.metadata) : null,
        notification.error_details || null
      ]);

      console.log(`✅ Created: ${notification.title}`);
    }

    console.log(`\n🎉 Successfully created ${testNotifications.length} test notifications!`);
    console.log('📊 You can now view them in the admin panel.\n');
    
    // Show summary
    const summary = testNotifications.reduce((acc, n) => {
      acc[n.severity] = (acc[n.severity] || 0) + 1;
      return acc;
    }, {});
    
    console.log('📈 Summary by severity:');
    Object.entries(summary).forEach(([severity, count]) => {
      console.log(`   ${severity}: ${count}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test notifications:', error);
    process.exit(1);
  }
}

// Wait for database to initialize
async function main() {
  await database.waitForMySQLInitialization();
  
  if (!database.isMySQLAvailable()) {
    console.error('❌ MySQL connection not available');
    process.exit(1);
  }
  
  await createTestNotifications();
}

main();

