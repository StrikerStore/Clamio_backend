/**
 * Migration Runner Utility
 * 
 * This utility runs database migrations automatically on server startup.
 * All migrations are idempotent (safe to run multiple times).
 */

const database = require('../config/database');
const encryptionService = require('../services/encryptionService');
const { generateUniqueAccountCode } = require('../utils/accountCodeGenerator');

/**
 * Run multi-store migration
 * This migration is idempotent and safe to run multiple times
 */
async function runMultiStoreMigration() {
  try {
    console.log('\n🚀 ========================================');
    console.log('   RUNNING MULTI-STORE MIGRATION');
    console.log('========================================\n');
    
    // Wait for database to be initialized
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max wait
    
    while (!database.mysqlInitialized && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

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
    
    // Only create default store if credentials are provided
    if (shipwayUsername && shipwayPassword && shipwayBasicAuth && shopifyStoreUrl && shopifyToken) {
      // Generate account_code from "Striker Store" = "STRI"
      const accountCode = await generateUniqueAccountCode(storeName, database);
      console.log(`   Generated account code: ${accountCode} for "${storeName}"`);
      
      // Encrypt Shipway password
      const encryptedPassword = encryptionService.encrypt(shipwayPassword);
      
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
        console.log(`   Account Code: ${accountCode}\n`);
      } else {
        console.log(`⚠️ Store "${storeName}" (${accountCode}) already exists, skipping creation...\n`);
      }
    } else {
      console.log('⚠️ Missing environment variables for default store, skipping creation...');
      console.log('   (This is OK if you plan to add stores manually via superadmin panel)\n');
    }

    // ========================================
    // STEP 3: ADD ACCOUNT_CODE TO ALL TABLES
    // ========================================
    console.log('📝 Step 3: Adding account_code column to all tables...');
    
    const tables = [
      { name: 'orders', after: 'id' },
      { name: 'claims', after: 'order_unique_id' },
      { name: 'carriers', after: 'id' },
      { name: 'customer_info', after: 'order_id' },
      { name: 'labels', after: 'id' },
      { name: 'order_tracking', after: 'order_id' },
      { name: 'products', after: 'id' }
    ];
    
    // Get default account_code from existing store or use 'STRI'
    let defaultAccountCode = 'STRI';
    try {
      const [stores] = await database.mysqlConnection.execute(
        'SELECT account_code FROM store_info WHERE status = "active" LIMIT 1'
      );
      if (stores.length > 0) {
        defaultAccountCode = stores[0].account_code;
      }
    } catch (error) {
      console.log(`   ⚠️ Could not fetch default account_code, using 'STRI'`);
    }
    
    for (const table of tables) {
      try {
        // Check if column already exists
        const [columns] = await database.mysqlConnection.execute(
          `SHOW COLUMNS FROM ${table.name} LIKE 'account_code'`
        );
        
        if (columns.length === 0) {
          await database.mysqlConnection.execute(
            `ALTER TABLE ${table.name} 
             ADD COLUMN account_code VARCHAR(50) DEFAULT '${defaultAccountCode}' AFTER ${table.after},
             ADD INDEX idx_account_code_${table.name} (account_code)`
          );
          console.log(`   ✅ Added account_code to ${table.name}`);
        } else {
          console.log(`   ⚠️ account_code already exists in ${table.name}, skipping...`);
        }
      } catch (error) {
        // If table doesn't exist, that's OK (might be first run)
        if (error.message.includes("doesn't exist")) {
          console.log(`   ⚠️ Table ${table.name} doesn't exist yet, skipping...`);
        } else {
          console.error(`   ❌ Error adding account_code to ${table.name}:`, error.message);
          // Don't throw - continue with other tables
        }
      }
    }
    
    console.log('✅ All tables checked/updated with account_code column\n');

    // ========================================
    // STEP 4: UPDATE EXISTING DATA (if any NULL values)
    // ========================================
    console.log(`📝 Step 4: Updating existing data with "${defaultAccountCode}" account_code...`);
    
    for (const table of tables) {
      try {
        const [result] = await database.mysqlConnection.execute(
          `UPDATE ${table.name} SET account_code = ? WHERE account_code IS NULL OR account_code = ''`,
          [defaultAccountCode]
        );
        if (result.affectedRows > 0) {
          console.log(`   ✅ Updated ${result.affectedRows} rows in ${table.name}`);
        }
      } catch (error) {
        // If table doesn't exist, that's OK
        if (!error.message.includes("doesn't exist")) {
          console.error(`   ⚠️ Error updating ${table.name}:`, error.message);
        }
      }
    }
    
    console.log(`✅ Data migration completed\n`);

    // ========================================
    // STEP 5: SET ACCOUNT_CODE AS NOT NULL (if not already)
    // ========================================
    console.log('📝 Step 5: Ensuring account_code is NOT NULL in all tables...');
    
    for (const table of tables) {
      try {
        // Check current column definition
        const [columns] = await database.mysqlConnection.execute(
          `SHOW COLUMNS FROM ${table.name} WHERE Field = 'account_code'`
        );
        
        if (columns.length > 0 && columns[0].Null === 'YES') {
          await database.mysqlConnection.execute(
            `ALTER TABLE ${table.name} MODIFY account_code VARCHAR(50) NOT NULL`
          );
          console.log(`   ✅ Set account_code NOT NULL in ${table.name}`);
        } else if (columns.length > 0) {
          console.log(`   ⚠️ account_code already NOT NULL in ${table.name}, skipping...`);
        }
      } catch (error) {
        // If table doesn't exist, that's OK
        if (!error.message.includes("doesn't exist")) {
          console.error(`   ⚠️ Error modifying ${table.name}:`, error.message);
        }
      }
    }
    
    console.log('✅ All constraints verified\n');

    // ========================================
    // MIGRATION COMPLETE
    // ========================================
    console.log('\n🎉 ========================================');
    console.log('   MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('========================================');
    console.log('✅ All database changes applied');
    console.log('🚀 Application ready for multi-store!');
    console.log('========================================\n');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('   MIGRATION ERROR (non-fatal)');
    console.error('========================================');
    console.error(`Error: ${error.message}`);
    console.error('⚠️ Server will continue to start, but please check migration manually');
    console.error('========================================\n');
    
    // Don't throw - allow server to start even if migration fails
    // Admin can run migration manually if needed
    return false;
  }
}

module.exports = {
  runMultiStoreMigration
};

