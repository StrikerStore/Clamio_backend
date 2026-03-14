/**
 * Migration Script: Rename shipway_username and shipway_password_encrypted columns
 * 
 * This script renames:
 * - shipway_username → username
 * - shipway_password_encrypted → password_encrypted
 * 
 * This migration is idempotent and safe to run multiple times.
 */

require('dotenv').config();
const database = require('../config/database');

async function migrateStoreInfoColumns() {
  try {
    console.log('\n🚀 ========================================');
    console.log('   MIGRATING STORE_INFO COLUMNS');
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
      console.log('   (Migration will run automatically when table is created)\n');
      return;
    }

    // Check current column names
    const [columns] = await database.mysqlConnection.execute(
      "SHOW COLUMNS FROM store_info"
    );
    
    const columnNames = columns.map(col => col.Field);
    const hasOldUsername = columnNames.includes('shipway_username');
    const hasNewUsername = columnNames.includes('username');
    const hasOldPassword = columnNames.includes('shipway_password_encrypted');
    const hasNewPassword = columnNames.includes('password_encrypted');

    // Migrate shipway_username → username
    if (hasOldUsername && !hasNewUsername) {
      console.log('📝 Renaming shipway_username → username...');
      await database.mysqlConnection.execute(
        'ALTER TABLE store_info CHANGE COLUMN shipway_username username VARCHAR(255) NOT NULL'
      );
      console.log('✅ Column renamed: shipway_username → username\n');
    } else if (hasNewUsername) {
      console.log('✅ Column "username" already exists, skipping...\n');
    } else {
      console.log('⚠️ Neither old nor new username column found. This is unexpected.\n');
    }

    // Migrate shipway_password_encrypted → password_encrypted
    if (hasOldPassword && !hasNewPassword) {
      console.log('📝 Renaming shipway_password_encrypted → password_encrypted...');
      await database.mysqlConnection.execute(
        'ALTER TABLE store_info CHANGE COLUMN shipway_password_encrypted password_encrypted TEXT NOT NULL'
      );
      console.log('✅ Column renamed: shipway_password_encrypted → password_encrypted\n');
    } else if (hasNewPassword) {
      console.log('✅ Column "password_encrypted" already exists, skipping...\n');
    } else {
      console.log('⚠️ Neither old nor new password column found. This is unexpected.\n');
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
migrateStoreInfoColumns();

