/**
 * Multi-Store Migration Script
 * 
 * This script:
 * 1. Creates store_info table
 * 2. Creates "Striker Store" from environment variables
 * 3. Adds account_code column to all related tables
 * 4. Migrates existing data to use "STRI" account code
 * 5. Sets account_code as NOT NULL
 */

const path = require('path');

// Load .env FIRST before requiring any other modules
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Now require modules that depend on environment variables
const database = require('../config/database');
const encryptionService = require('../services/encryptionService');
const { generateUniqueAccountCode } = require('../utils/accountCodeGenerator');

async function migrateMultiStore() {
  try {
    console.log('\n🚀 ========================================');
    console.log('   MULTI-STORE MIGRATION');
    console.log('========================================\n');
    
    // Wait for database to initialize
    await new Promise(resolve => {
      const checkInit = setInterval(() => {
        if (database.mysqlInitialized) {
          clearInterval(checkInit);
          resolve();
        }
      }, 100);
    });

    if (!database.mysqlConnection) {
      throw new Error('Database connection not available');
    }

    // ========================================
    // STEP 1: CREATE STORE_INFO TABLE
    // ========================================
    console.log('📝 Step 1: Creating store_info table...');
    
    await database.mysqlConnection.execute(`
      CREATE TABLE IF NOT EXISTS store_info (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_code VARCHAR(50) UNIQUE NOT NULL,
        store_name VARCHAR(255) NOT NULL,
        shipping_partner VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        password_encrypted TEXT NOT NULL,
        auth_token TEXT NOT NULL,
        shopify_store_url VARCHAR(255) NOT NULL,
        shopify_token TEXT NOT NULL,
        status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(50),
        last_synced_at TIMESTAMP NULL,
        last_shopify_sync_at TIMESTAMP NULL,
        INDEX idx_status (status),
        INDEX idx_account_code (account_code),
        INDEX idx_shipping_partner (shipping_partner)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('✅ store_info table created/verified\n');

    // ========================================
    // STEP 2: CREATE "STRIKER STORE" FROM ENV
    // ========================================
    console.log('📝 Step 2: Creating "Striker Store" from environment variables...');
    
    const storeName = 'Striker Store';
    const shipwayUsername = process.env.SHIPWAY_USERNAME;
    const shipwayPassword = process.env.SHIPWAY_PASSWORD;
    const shipwayBasicAuth = process.env.SHIPWAY_BASIC_AUTH_HEADER;
    const shopifyStoreUrl = process.env.SHOPIFY_STORE_URL;
    const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;
    
    // Validate all required fields
    console.log('   Validating environment variables...');
    
    if (!shipwayUsername || !shipwayPassword || !shipwayBasicAuth) {
      throw new Error('Missing Shipway credentials in .env: SHIPWAY_USERNAME, SHIPWAY_PASSWORD, SHIPWAY_BASIC_AUTH_HEADER are required');
    }
    
    if (!shopifyStoreUrl || !shopifyToken) {
      throw new Error('Missing Shopify credentials in .env: SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN are required');
    }
    
    console.log('   ✅ All environment variables found');
    
    // Generate account_code from "Striker Store" = "STRI"
    const accountCode = await generateUniqueAccountCode(storeName, database);
    console.log(`   Generated account code: ${accountCode} for "${storeName}"`);
    
    // Encrypt Shipway password
    console.log('   Encrypting Shipway password...');
    const encryptedPassword = encryptionService.encrypt(shipwayPassword);
    console.log('   ✅ Password encrypted');
    
    // Check if store already exists
    const [existing] = await database.mysqlConnection.execute(
      'SELECT * FROM store_info WHERE account_code = ?',
      [accountCode]
    );
    
    if (existing.length === 0) {
      await database.mysqlConnection.execute(`
        INSERT INTO store_info (
          account_code,
          store_name,
          username,
          password_encrypted,
          auth_token,
          shopify_store_url,
          shopify_token,
          status,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        accountCode,
        storeName,
        shipwayUsername,
        encryptedPassword,
        shipwayBasicAuth,
        shopifyStoreUrl,
        shopifyToken,
        'active',
        'system'
      ]);
      
      console.log(`✅ "${storeName}" created successfully!`);
      console.log(`   Account Code: ${accountCode}`);
      console.log(`   Status: active`);
      console.log(`   Shipway Username: ${shipwayUsername}`);
      console.log(`   Shopify Store: ${shopifyStoreUrl}\n`);
    } else {
      console.log(`⚠️ Store "${storeName}" (${accountCode}) already exists, skipping creation...\n`);
    }

    // ========================================
    // STEP 3: ADD ACCOUNT_CODE TO ALL TABLES
    // ========================================
    console.log('📝 Step 3: Adding account_code column to all tables...');
    
    const tables = [
      { name: 'orders', after: 'id' },
      { name: 'claims', after: 'order_unique_id' },
      { name: 'carriers', after: 'id' },
      { name: 'customer_info', after: 'order_id' },  // customer_info uses order_id, not id
      { name: 'labels', after: 'id' },
      { name: 'order_tracking', after: 'order_id' },
      { name: 'products', after: 'id' }
    ];
    
    for (const table of tables) {
      try {
        // Check if column already exists
        const [columns] = await database.mysqlConnection.execute(
          `SHOW COLUMNS FROM ${table.name} LIKE 'account_code'`
        );
        
        if (columns.length === 0) {
          await database.mysqlConnection.execute(
            `ALTER TABLE ${table.name} 
             ADD COLUMN account_code VARCHAR(50) DEFAULT '${accountCode}' AFTER ${table.after},
             ADD INDEX idx_account_code_${table.name} (account_code)`
          );
          console.log(`   ✅ Added account_code to ${table.name}`);
        } else {
          console.log(`   ⚠️ account_code already exists in ${table.name}, skipping...`);
        }
      } catch (error) {
        console.error(`   ❌ Error adding account_code to ${table.name}:`, error.message);
        throw error;
      }
    }
    
    console.log('✅ All tables updated with account_code column\n');

    // ========================================
    // STEP 4: UPDATE EXISTING DATA
    // ========================================
    console.log(`📝 Step 4: Updating existing data with "${accountCode}" account_code...`);
    
    for (const table of tables) {
      try {
        const [result] = await database.mysqlConnection.execute(
          `UPDATE ${table.name} SET account_code = ? WHERE account_code IS NULL`,
          [accountCode]
        );
        console.log(`   ✅ Updated ${result.affectedRows} rows in ${table.name}`);
      } catch (error) {
        console.error(`   ❌ Error updating ${table.name}:`, error.message);
        throw error;
      }
    }
    
    console.log(`✅ All existing data updated to "${accountCode}"\n`);

    // ========================================
    // STEP 5: SET ACCOUNT_CODE AS NOT NULL
    // ========================================
    console.log('📝 Step 5: Setting account_code as NOT NULL in all tables...');
    
    for (const table of tables) {
      try {
        await database.mysqlConnection.execute(
          `ALTER TABLE ${table.name} MODIFY account_code VARCHAR(50) NOT NULL`
        );
        console.log(`   ✅ Set account_code NOT NULL in ${table.name}`);
      } catch (error) {
        console.error(`   ❌ Error modifying ${table.name}:`, error.message);
        throw error;
      }
    }
    
    console.log('✅ All columns set to NOT NULL\n');

    // ========================================
    // MIGRATION COMPLETE
    // ========================================
    console.log('\n🎉 ========================================');
    console.log('   MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('========================================');
    console.log('');
    console.log('📊 Summary:');
    console.log(`   ✅ store_info table created`);
    console.log(`   ✅ Default store: ${storeName} (${accountCode})`);
    console.log(`   ✅ account_code added to 7 tables`);
    console.log(`   ✅ All existing data tagged with: ${accountCode}`);
    console.log(`   ✅ All constraints applied`);
    console.log('');
    console.log('🚀 Your application is now ready for multi-store!');
    console.log('   Superadmin can add more stores via the admin panel.');
    console.log('========================================\n');
    
  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('   MIGRATION FAILED!');
    console.error('========================================');
    console.error(`Error: ${error.message}`);
    console.error('\nPlease fix the error and run the migration again.');
    console.error('========================================\n');
    throw error;
  }
}

// Run migration
console.log('\n⏳ Starting migration in 2 seconds...\n');
setTimeout(() => {
  migrateMultiStore()
    .then(() => {
      console.log('✅ Migration script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Migration script failed:', error.message);
      process.exit(1);
    });
}, 2000);

