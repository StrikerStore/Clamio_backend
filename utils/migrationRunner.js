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

/**
 * Run Shopify Connections migration
 * Moves Shopify data from store_info to new store_shopify_connections table
 * Also changes products.id to AUTO_INCREMENT and deduplicates on (account_code, sku_id)
 * This migration is idempotent and safe to run multiple times
 */
async function runShopifyConnectionsMigration() {
  try {
    console.log('\n🚀 ========================================');
    console.log('   RUNNING SHOPIFY CONNECTIONS MIGRATION');
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

    // Check if migration already completed
    try {
      const [rows] = await database.mysqlConnection.execute(
        `SELECT value FROM utility WHERE parameter = 'shopify_connections_migration_completed'`
      );
      if (rows.length > 0 && rows[0].value === 'true') {
        console.log('✅ Shopify connections migration already completed, skipping...\n');
        
        // Still run column rename check (added later)
        await renameStoreNameToBrandName(database);
        await ensureUniqueAccountStoreCode(database);
        await ensureProductsSkuIdNotNull(database);
        
        return true;
      }
    } catch (err) {
      // utility table might not exist yet, continue
      console.log('ℹ️ Could not check migration status, proceeding...');
    }

    // ========================================
    // STEP 1: CREATE store_shopify_connections TABLE
    // ========================================
    console.log('📝 Step 1: Creating store_shopify_connections table...');

    await database.mysqlConnection.execute(`
      CREATE TABLE IF NOT EXISTS store_shopify_connections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_code VARCHAR(50) NOT NULL,
        brand_name VARCHAR(255) NOT NULL,
        store_code VARCHAR(50) NOT NULL DEFAULT '1',
        shopify_store_url VARCHAR(255) NOT NULL,
        shopify_token TEXT NOT NULL,
        status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
        last_synced_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_account_code (account_code),
        INDEX idx_store_code (store_code),
        INDEX idx_status (status),
        INDEX idx_account_store (account_code, store_code),
        FOREIGN KEY (account_code) REFERENCES store_info(account_code) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ store_shopify_connections table created/verified\n');

    // ========================================
    // STEP 2: MIGRATE DATA FROM store_info → store_shopify_connections
    // ========================================
    console.log('📝 Step 2: Migrating Shopify data from store_info to store_shopify_connections...');

    // Check if store_info still has shopify columns (migration not yet done)
    let hasShopifyColumns = false;
    try {
      const [cols] = await database.mysqlConnection.execute(
        `SHOW COLUMNS FROM store_info LIKE 'shopify_store_url'`
      );
      hasShopifyColumns = cols.length > 0;
    } catch (err) {
      console.log('   ⚠️ Could not check store_info columns:', err.message);
    }

    if (hasShopifyColumns) {
      // Get all existing stores with Shopify data
      const [stores] = await database.mysqlConnection.execute(
        `SELECT account_code, store_name, shopify_store_url, shopify_token, last_shopify_sync_at, status
         FROM store_info 
         WHERE shopify_store_url IS NOT NULL AND shopify_store_url != ''`
      );

      console.log(`   Found ${stores.length} stores with Shopify data to migrate`);

      for (const store of stores) {
        // Check if connection already exists (idempotent)
        const [existing] = await database.mysqlConnection.execute(
          `SELECT id FROM store_shopify_connections WHERE account_code = ? AND shopify_store_url = ?`,
          [store.account_code, store.shopify_store_url]
        );

        if (existing.length === 0) {
          await database.mysqlConnection.execute(
            `INSERT INTO store_shopify_connections 
              (account_code, brand_name, store_code, shopify_store_url, shopify_token, status, last_synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              store.account_code,
              store.store_name,
              '1',
              store.shopify_store_url,
              store.shopify_token,
              store.status,
              store.last_shopify_sync_at
            ]
          );
          console.log(`   ✅ Migrated Shopify data for "${store.store_name}" (${store.account_code})`);
        } else {
          console.log(`   ⚠️ Shopify connection already exists for "${store.store_name}" (${store.account_code}), skipping...`);
        }
      }

      console.log('✅ Shopify data migration completed\n');

      // ========================================
      // STEP 3: DROP SHOPIFY COLUMNS FROM store_info
      // ========================================
      console.log('📝 Step 3: Dropping Shopify columns from store_info...');

      const columnsToDrop = ['shopify_store_url', 'shopify_token', 'last_shopify_sync_at'];

      for (const col of columnsToDrop) {
        try {
          const [colCheck] = await database.mysqlConnection.execute(
            `SHOW COLUMNS FROM store_info LIKE '${col}'`
          );
          if (colCheck.length > 0) {
            await database.mysqlConnection.execute(
              `ALTER TABLE store_info DROP COLUMN ${col}`
            );
            console.log(`   ✅ Dropped column: ${col}`);
          } else {
            console.log(`   ⚠️ Column ${col} already dropped, skipping...`);
          }
        } catch (err) {
          console.error(`   ❌ Error dropping column ${col}:`, err.message);
        }
      }

      console.log('✅ Shopify columns dropped from store_info\n');
    } else {
      console.log('   ⚠️ Shopify columns already removed from store_info, skipping data migration...\n');
    }

    // ========================================
    // STEP 4: MIGRATE PRODUCTS TABLE — Change id to AUTO_INCREMENT
    // ========================================
    console.log('📝 Step 4: Migrating products table to AUTO_INCREMENT id...');

    try {
      // Check if products.id is still VARCHAR (old schema)
      const [productIdCol] = await database.mysqlConnection.execute(
        `SHOW COLUMNS FROM products WHERE Field = 'id'`
      );

      if (productIdCol.length > 0 && productIdCol[0].Type.includes('varchar')) {
        console.log('   Products table has VARCHAR id, migrating to AUTO_INCREMENT...');

        // 4a. Add a temporary auto_increment column
        try {
          await database.mysqlConnection.execute(
            `ALTER TABLE products ADD COLUMN new_id INT AUTO_INCREMENT UNIQUE FIRST`
          );
          console.log('   ✅ Added new_id auto-increment column');
        } catch (err) {
          if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('   ⚠️ new_id column already exists');
          } else {
            throw err;
          }
        }

        // 4b. Drop old primary key and old id column
        try {
          await database.mysqlConnection.execute(`ALTER TABLE products DROP PRIMARY KEY`);
          console.log('   ✅ Dropped old PRIMARY KEY');
        } catch (err) {
          console.log('   ⚠️ Could not drop old PRIMARY KEY:', err.message);
        }

        try {
          await database.mysqlConnection.execute(`ALTER TABLE products DROP COLUMN id`);
          console.log('   ✅ Dropped old VARCHAR id column');
        } catch (err) {
          console.log('   ⚠️ Could not drop old id column:', err.message);
        }

        // 4c. Rename new_id → id and make it PRIMARY KEY
        try {
          await database.mysqlConnection.execute(
            `ALTER TABLE products CHANGE COLUMN new_id id INT AUTO_INCREMENT PRIMARY KEY`
          );
          console.log('   ✅ Renamed new_id to id as AUTO_INCREMENT PRIMARY KEY');
        } catch (err) {
          console.log('   ⚠️ Could not rename new_id to id:', err.message);
        }

        console.log('✅ Products table migrated to AUTO_INCREMENT id\n');
      } else {
        console.log('   ⚠️ Products.id is already INT/AUTO_INCREMENT, skipping...\n');
      }
    } catch (err) {
      if (err.message.includes("doesn't exist")) {
        console.log('   ⚠️ Products table does not exist yet, skipping migration...\n');
      } else {
        console.error('   ❌ Error migrating products table:', err.message);
      }
    }

    // ========================================
    // STEP 5: DEDUPLICATE PRODUCTS on (account_code, sku_id)
    // ========================================
    console.log('📝 Step 5: Deduplicating products on (account_code, sku_id)...');

    try {
      // Delete duplicates keeping the row with the highest id (most recent)
      // Only deduplicate rows where sku_id IS NOT NULL
      const [dupResult] = await database.mysqlConnection.execute(`
        DELETE p1 FROM products p1
        INNER JOIN products p2 
        WHERE p1.account_code = p2.account_code 
          AND p1.sku_id = p2.sku_id 
          AND p1.sku_id IS NOT NULL
          AND p1.id < p2.id
      `);

      if (dupResult.affectedRows > 0) {
        console.log(`   ✅ Removed ${dupResult.affectedRows} duplicate product rows`);
      } else {
        console.log('   ✅ No duplicate products found');
      }
    } catch (err) {
      if (err.message.includes("doesn't exist")) {
        console.log('   ⚠️ Products table does not exist yet, skipping deduplication...');
      } else {
        console.error('   ❌ Error deduplicating products:', err.message);
      }
    }

    // ========================================
    // STEP 6: ADD UNIQUE KEY on (account_code, sku_id) WHERE sku_id IS NOT NULL
    // ========================================
    console.log('📝 Step 6: Adding UNIQUE constraint on (account_code, sku_id)...');

    try {
      // Check if unique index already exists
      const [indexes] = await database.mysqlConnection.execute(
        `SHOW INDEX FROM products WHERE Key_name = 'uq_account_sku'`
      );

      if (indexes.length === 0) {
        await database.mysqlConnection.execute(
          `ALTER TABLE products ADD UNIQUE KEY uq_account_sku (account_code, sku_id)`
        );
        console.log('   ✅ Added UNIQUE KEY uq_account_sku (account_code, sku_id)');
      } else {
        console.log('   ⚠️ UNIQUE KEY uq_account_sku already exists, skipping...');
      }
    } catch (err) {
      if (err.message.includes("doesn't exist")) {
        console.log('   ⚠️ Products table does not exist yet, skipping unique key...');
      } else {
        console.error('   ❌ Error adding unique key:', err.message);
      }
    }

    console.log('');

    // ========================================
    // STEP 7: MARK MIGRATION COMPLETE
    // ========================================
    console.log('📝 Step 7: Marking migration as complete...');

    try {
      await database.mysqlConnection.execute(
        `INSERT INTO utility (parameter, value, created_by)
         VALUES ('shopify_connections_migration_completed', 'true', 'system')
         ON DUPLICATE KEY UPDATE value = 'true', modified_at = NOW()`
      );
      console.log('   ✅ Migration marked as complete');
    } catch (err) {
      console.error('   ❌ Error marking migration complete:', err.message);
    }

    // ========================================
    // STEP 8: RENAME store_name → brand_name (if needed)
    // ========================================
    await renameStoreNameToBrandName(database);
    await ensureUniqueAccountStoreCode(database);
    await ensureProductsSkuIdNotNull(database);

    // ========================================
    // MIGRATION COMPLETE
    // ========================================
    console.log('\n🎉 ========================================');
    console.log('   SHOPIFY CONNECTIONS MIGRATION COMPLETED!');
    console.log('========================================');
    console.log('✅ store_shopify_connections table created');
    console.log('✅ Shopify data migrated from store_info');
    console.log('✅ Products table migrated to AUTO_INCREMENT');
    console.log('✅ Products deduplicated on (account_code, sku_id)');
    console.log('✅ Column renamed: store_name → brand_name');
    console.log('========================================\n');

    return true;

  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('   SHOPIFY CONNECTIONS MIGRATION ERROR (non-fatal)');
    console.error('========================================');
    console.error(`Error: ${error.message}`);
    console.error('⚠️ Server will continue to start, but please check migration manually');
    console.error('========================================\n');

    // Don't throw - allow server to start even if migration fails
    return false;
  }
}

/**
 * Rename store_name → brand_name in store_shopify_connections table
 * This is idempotent - checks if column exists before renaming
 */
async function renameStoreNameToBrandName(db) {
  try {
    // Check if store_shopify_connections table exists
    const [tables] = await db.mysqlConnection.execute(
      `SHOW TABLES LIKE 'store_shopify_connections'`
    );
    if (tables.length === 0) {
      return; // Table doesn't exist yet, nothing to rename
    }

    // Check if old column 'store_name' still exists
    const [cols] = await db.mysqlConnection.execute(
      `SHOW COLUMNS FROM store_shopify_connections LIKE 'store_name'`
    );

    if (cols.length > 0) {
      console.log('📝 Renaming store_shopify_connections.store_name → brand_name...');
      await db.mysqlConnection.execute(
        `ALTER TABLE store_shopify_connections CHANGE COLUMN store_name brand_name VARCHAR(255) NOT NULL`
      );
      console.log('✅ Column renamed: store_name → brand_name\n');
    } else {
      // Check if brand_name already exists (already renamed)
      const [brandCols] = await db.mysqlConnection.execute(
        `SHOW COLUMNS FROM store_shopify_connections LIKE 'brand_name'`
      );
      if (brandCols.length > 0) {
        console.log('✅ store_shopify_connections.brand_name already exists, no rename needed\n');
      }
    }
  } catch (err) {
    console.error('❌ Error renaming store_name to brand_name:', err.message);
  }
}

/**
 * Ensure store_shopify_connections has UNIQUE(account_code, store_code).
 * If duplicates exist, keep the most recently updated row (highest updated_at, then highest id).
 */
async function ensureUniqueAccountStoreCode(db) {
  try {
    const [tables] = await db.mysqlConnection.execute(
      `SHOW TABLES LIKE 'store_shopify_connections'`
    );
    if (tables.length === 0) return;

    // Check if unique index already exists
    const [idx] = await db.mysqlConnection.execute(
      `SHOW INDEX FROM store_shopify_connections WHERE Key_name = 'uq_account_store_code'`
    );
    if (idx.length > 0) {
      return;
    }

    console.log('🧹 Deduping store_shopify_connections on (account_code, store_code) before adding unique index...');

    // Delete duplicates keeping the most recently updated row per (account_code, store_code)
    await db.mysqlConnection.execute(`
      DELETE sc1 FROM store_shopify_connections sc1
      JOIN store_shopify_connections sc2
        ON sc1.account_code = sc2.account_code
       AND sc1.store_code = sc2.store_code
       AND (
            sc1.updated_at < sc2.updated_at
         OR (sc1.updated_at = sc2.updated_at AND sc1.id < sc2.id)
       )
    `);

    console.log('📝 Adding UNIQUE KEY uq_account_store_code (account_code, store_code)...');
    await db.mysqlConnection.execute(
      `ALTER TABLE store_shopify_connections
       ADD UNIQUE KEY uq_account_store_code (account_code, store_code)`
    );
    console.log('✅ Unique index added: uq_account_store_code\n');
  } catch (err) {
    console.error('❌ Error ensuring unique index on store_shopify_connections:', err.message);
  }
}

/**
 * Ensure products.sku_id is NOT NULL.
 * - Deletes existing rows where sku_id is NULL or blank
 * - Alters column to NOT NULL
 */
async function ensureProductsSkuIdNotNull(db) {
  try {
    const [tables] = await db.mysqlConnection.execute(`SHOW TABLES LIKE 'products'`);
    if (tables.length === 0) return;

    // Remove invalid rows first to avoid ALTER failures
    const [delRes] = await db.mysqlConnection.execute(
      `DELETE FROM products WHERE sku_id IS NULL OR TRIM(sku_id) = ''`
    );
    if (delRes.affectedRows > 0) {
      console.log(`🧹 Deleted ${delRes.affectedRows} products with NULL/blank sku_id`);
    }

    const [cols] = await db.mysqlConnection.execute(
      `SHOW COLUMNS FROM products WHERE Field = 'sku_id'`
    );
    if (cols.length === 0) return;

    if (cols[0].Null === 'YES') {
      console.log('📝 Altering products.sku_id to NOT NULL...');
      await db.mysqlConnection.execute(
        `ALTER TABLE products MODIFY sku_id VARCHAR(100) NOT NULL`
      );
      console.log('✅ products.sku_id is now NOT NULL\n');
    }
  } catch (err) {
    console.error('❌ Error ensuring products.sku_id NOT NULL:', err.message);
  }
}

module.exports = {
  runMultiStoreMigration,
  runShopifyConnectionsMigration
};

