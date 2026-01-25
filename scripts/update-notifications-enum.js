/**
 * Update notifications table ENUM to include 'system_notification'
 * This script adds the missing notification type to the existing database
 */

const Database = require('../config/database');

async function updateNotificationsEnum() {
  try {
    console.log('🔄 Updating notifications table ENUM...');
    
    // First, let's check the current ENUM values
    const [currentEnum] = await Database.query(`
      SELECT COLUMN_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'notifications' 
      AND COLUMN_NAME = 'type'
    `);
    
    console.log('📋 Current ENUM values:', currentEnum[0]?.COLUMN_TYPE);
    
    // Check if 'system_notification' already exists
    const enumValues = currentEnum[0]?.COLUMN_TYPE || '';
    if (enumValues.includes('system_notification')) {
      console.log('✅ system_notification already exists in ENUM');
      return;
    }
    
    // Update the ENUM to include 'system_notification'
    await Database.query(`
      ALTER TABLE notifications 
      MODIFY COLUMN type ENUM(
        'reverse_order_failure',
        'shipment_assignment_error',
        'carrier_unavailable',
        'low_balance',
        'warehouse_issue',
        'payment_failed',
        'order_stuck',
        'vendor_error',
        'vendor_api_error',
        'vendor_connection_error',
        'vendor_validation_error',
        'vendor_timeout_error',
        'vendor_authentication_error',
        'order_claim_error',
        'order_processing_error',
        'label_download_error',
        'authentication_error',
        'data_fetch_error',
        'data_refresh_error',
        'settlement_error',
        'address_error',
        'file_upload_error',
        'file_download_error',
        'vendor_operation_error',
        'system_notification',
        'other'
      ) NOT NULL
    `);
    
    console.log('✅ Successfully updated notifications table ENUM');
    
    // Verify the update
    const [updatedEnum] = await Database.query(`
      SELECT COLUMN_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'notifications' 
      AND COLUMN_NAME = 'type'
    `);
    
    console.log('📋 Updated ENUM values:', updatedEnum[0]?.COLUMN_TYPE);
    
  } catch (error) {
    console.error('❌ Error updating notifications ENUM:', error);
    throw error;
  } finally {
    await Database.close();
  }
}

// Run the update if this script is executed directly
if (require.main === module) {
  updateNotificationsEnum()
    .then(() => {
      console.log('🎉 Notifications ENUM update completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Notifications ENUM update failed:', error);
      process.exit(1);
    });
}

module.exports = { updateNotificationsEnum };
