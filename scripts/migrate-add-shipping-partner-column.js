/**
 * Migration Script: Add shipping_partner column to store_info table
 * 
 * This script adds the shipping_partner column to existing store_info tables.
 * This migration is idempotent and safe to run multiple times.
 */

require('dotenv').config();
const database = require('../config/database');

async function migrateShippingPartnerColumn() {
  try {
    console.log('\n🚀 ========================================');
    console.log('   ADDING SHIPPING_PARTNER COLUMN');
    console.log('========================================\n');
    
    // Wait for database to be initialized
    let attempts = 0;
    const maxAttempts = 50;
    
    while (!database.mysqlInitialized && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!database.mysqlConnection) {
      throw new Error('Database connection not available');
    }

    // Check if table exists
    const [tables] = await database.mysqlConnection.execute(
      "SHOW TABLES LIKE 'store_info'"
    );
    
    if (tables.length === 0) {
      console.log('⚠️ store_info table does not exist yet. Skipping migration.');
      console.log('   (Column will be added automatically when table is created)\n');
      return;
    }

    // Check if column already exists
    const [columns] = await database.mysqlConnection.execute(
      "SHOW COLUMNS FROM store_info LIKE 'shipping_partner'"
    );
    
    if (columns.length > 0) {
      console.log('✅ Column "shipping_partner" already exists, skipping...\n');
    } else {
      console.log('📝 Adding shipping_partner column...');
      
      // Add column with default value for existing rows
      await database.mysqlConnection.execute(
        'ALTER TABLE store_info ADD COLUMN shipping_partner VARCHAR(255) NOT NULL DEFAULT "Shipway" AFTER store_name'
      );
      
      // Add index
      await database.mysqlConnection.execute(
        'ALTER TABLE store_info ADD INDEX idx_shipping_partner (shipping_partner)'
      );
      
      console.log('✅ Column "shipping_partner" added successfully\n');
    }

    // Ensure utility table allows multiple shipping partners
    console.log('📝 Checking utility table structure...');
    const [utilityColumns] = await database.mysqlConnection.execute(
      "SHOW COLUMNS FROM utility"
    );
    
    const hasParameterColumn = utilityColumns.some(col => col.Field === 'parameter');
    const hasValueColumn = utilityColumns.some(col => col.Field === 'value');
    
    if (!hasParameterColumn || !hasValueColumn) {
      console.log('⚠️ Utility table structure may need updating');
    } else {
      console.log('✅ Utility table structure is correct');
    }

    // Ensure "Shipway" exists in utility table
    console.log('📝 Ensuring "Shipway" shipping partner exists...');
    try {
      await database.mysqlConnection.execute(
        `INSERT INTO utility (parameter, value, created_by)
         VALUES ('shipping_partner', 'Shipway', 'system')
         ON DUPLICATE KEY UPDATE modified_at = CURRENT_TIMESTAMP`
      );
      console.log('✅ "Shipway" shipping partner added/verified\n');
    } catch (error) {
      // If unique constraint error, that's fine - it already exists
      if (error.message.includes('Duplicate entry')) {
        console.log('✅ "Shipway" shipping partner already exists\n');
      } else {
        throw error;
      }
    }

    console.log('🎉 ========================================');
    console.log('   MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('========================================\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('   MIGRATION ERROR');
    console.error('========================================');
    console.error(`Error: ${error.message}`);
    console.error('========================================\n');
    
    process.exit(1);
  }
}

// Run migration
migrateShippingPartnerColumn();

