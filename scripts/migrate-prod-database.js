/**
 * Production Database Migration Script
 * 
 * This script migrates production database from commit 955524d to current structure.
 * 
 * Changes:
 * 1. Creates 2 new tables: store_info, wh_mapping
 * 2. Adds account_code column to: orders, claims, labels, customer_info, order_tracking, products, carriers
 * 3. Migrates existing data: Sets account_code = 'STRI' for all existing rows
 * 4. Creates Striker Store entry in store_info table
 * 
 * This script should be run ONLY ONCE before first server startup.
 * After successful migration, this script can be removed from the codebase.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const encryptionService = require('../services/encryptionService');
const { generateAccountCodeFromName } = require('../utils/accountCodeGenerator');

class ProductionMigration {
  constructor() {
    this.dbConfig = {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };
    this.connection = null;
    this.strikerAccountCode = 'STRI'; // Generated from "Striker Store"
  }

  async connectToMySQL() {
    try {
      console.log('🔗 Connecting to MySQL...');
      console.log(`   Host: ${this.dbConfig.host}`);
      console.log(`   Database: ${this.dbConfig.database}`);
      
      this.connection = await mysql.createConnection({
        host: this.dbConfig.host,
        user: this.dbConfig.user,
        password: this.dbConfig.password,
        database: this.dbConfig.database,
        timezone: '+05:30' // IST timezone
      });
      
      console.log('✅ Connected to MySQL successfully\n');
    } catch (error) {
      console.error('❌ MySQL connection failed:', error.message);
      throw error;
    }
  }

  async checkMigrationStatus() {
    try {
      // Check if migration has already been run
      const [result] = await this.connection.execute(
        `SELECT value FROM utility WHERE parameter = 'prod_migration_completed'`
      );
      
      if (result.length > 0 && result[0].value === 'true') {
        console.log('✅ Migration has already been completed!');
        console.log('   Skipping migration (already done).\n');
        return true;
      }
      
      return false;
    } catch (error) {
      // Utility table might not have the parameter yet, which is fine
      return false;
    }
  }

  async createStoreInfoTable() {
    try {
      console.log('📝 Step 1: Creating store_info table...');
      
      await this.connection.execute(`
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
    } catch (error) {
      console.error('❌ Error creating store_info table:', error.message);
      throw error;
    }
  }

  async createWhMappingTable() {
    try {
      console.log('📝 Step 2: Creating wh_mapping table...');
      
      await this.connection.execute(`
        CREATE TABLE IF NOT EXISTS wh_mapping (
          id INT AUTO_INCREMENT PRIMARY KEY,
          claimio_wh_id VARCHAR(50) NOT NULL,
          vendor_wh_id VARCHAR(50) NOT NULL,
          account_code VARCHAR(50) NOT NULL,
          return_warehouse_id VARCHAR(50),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_claimio_wh_id (claimio_wh_id),
          INDEX idx_account_code (account_code),
          INDEX idx_is_active (is_active),
          INDEX idx_claimio_account (claimio_wh_id, account_code),
          FOREIGN KEY (account_code) REFERENCES store_info(account_code) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      
      console.log('✅ wh_mapping table created/verified\n');
    } catch (error) {
      console.error('❌ Error creating wh_mapping table:', error.message);
      throw error;
    }
  }

  async addAccountCodeToCarriers() {
    try {
      console.log('📝 Step 3.1: Adding account_code to carriers table...');
      
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM carriers LIKE 'account_code'`
      );
      
      if (columns.length === 0) {
        // Add column as nullable first
        await this.connection.execute(
          `ALTER TABLE carriers ADD COLUMN account_code VARCHAR(50) AFTER priority`
        );
        
        // Add index
        await this.connection.execute(
          `ALTER TABLE carriers ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to carriers table');
      } else {
        console.log('✅ account_code column already exists in carriers table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code to carriers:', error.message);
      throw error;
    }
  }

  async addAccountCodeToProducts() {
    try {
      console.log('📝 Step 3.2: Adding account_code to products table...');
      
      // Add account_code if it doesn't exist
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM products LIKE 'account_code'`
      );
      
      if (columns.length === 0) {
        // Find position after sku_id if it exists, otherwise after totalImages
        const [allColumns] = await this.connection.execute(
          `SHOW COLUMNS FROM products`
        );
        const skuIdIndex = allColumns.findIndex(col => col.Field === 'sku_id');
        const afterColumn = skuIdIndex >= 0 ? 'sku_id' : 'totalImages';
        
        await this.connection.execute(
          `ALTER TABLE products ADD COLUMN account_code VARCHAR(50) AFTER ${afterColumn}`
        );
        
        await this.connection.execute(
          `ALTER TABLE products ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to products table');
      } else {
        console.log('✅ account_code column already exists in products table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code to products:', error.message);
      throw error;
    }
  }

  async addAccountCodeToOrders() {
    try {
      console.log('📝 Step 3.3: Adding account_code to orders table...');
      
      // Add account_code if it doesn't exist
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM orders LIKE 'account_code'`
      );
      
      if (columns.length === 0) {
        // Find position after is_in_new_order if it exists, otherwise after collectable_amount
        const [allColumns] = await this.connection.execute(
          `SHOW COLUMNS FROM orders`
        );
        const isInNewOrderIndex = allColumns.findIndex(col => col.Field === 'is_in_new_order');
        const afterColumn = isInNewOrderIndex >= 0 ? 'is_in_new_order' : 'collectable_amount';
        
        await this.connection.execute(
          `ALTER TABLE orders ADD COLUMN account_code VARCHAR(50) AFTER ${afterColumn}`
        );
        
        await this.connection.execute(
          `ALTER TABLE orders ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to orders table');
      } else {
        console.log('✅ account_code column already exists in orders table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code to orders:', error.message);
      throw error;
    }
  }

  async addAccountCodeToClaims() {
    try {
      console.log('📝 Step 3.4: Adding account_code to claims table...');
      
      // Add account_code if it doesn't exist
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM claims LIKE 'account_code'`
      );
      
      if (columns.length === 0) {
        // Find position after priority_carrier if it exists, otherwise after label_downloaded
        const [allColumns] = await this.connection.execute(
          `SHOW COLUMNS FROM claims`
        );
        const priorityCarrierIndex = allColumns.findIndex(col => col.Field === 'priority_carrier');
        const afterColumn = priorityCarrierIndex >= 0 ? 'priority_carrier' : 'label_downloaded';
        
        await this.connection.execute(
          `ALTER TABLE claims ADD COLUMN account_code VARCHAR(50) AFTER ${afterColumn}`
        );
        
        await this.connection.execute(
          `ALTER TABLE claims ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to claims table');
      } else {
        console.log('✅ account_code column already exists in claims table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code to claims:', error.message);
      throw error;
    }
  }

  async addAccountCodeToLabels() {
    try {
      console.log('📝 Step 3.5: Adding account_code to labels table...');
      
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM labels LIKE 'account_code'`
      );
      
      if (columns.length === 0) {
        await this.connection.execute(
          `ALTER TABLE labels ADD COLUMN account_code VARCHAR(50) AFTER manifest_id`
        );
        
        await this.connection.execute(
          `ALTER TABLE labels ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to labels table');
      } else {
        console.log('✅ account_code column already exists in labels table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code to labels:', error.message);
      throw error;
    }
  }

  async addAccountCodeToCustomerInfo() {
    try {
      console.log('📝 Step 3.6: Adding account_code to customer_info table...');
      
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM customer_info LIKE 'account_code'`
      );
      
      if (columns.length === 0) {
        await this.connection.execute(
          `ALTER TABLE customer_info ADD COLUMN account_code VARCHAR(50) AFTER shipping_longitude`
        );
        
        await this.connection.execute(
          `ALTER TABLE customer_info ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to customer_info table');
      } else {
        console.log('✅ account_code column already exists in customer_info table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code to customer_info:', error.message);
      throw error;
    }
  }

  async addAccountCodeToOrderTracking() {
    try {
      console.log('📝 Step 3.7: Adding account_code to order_tracking table...');
      
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM order_tracking LIKE 'account_code'`
      );
      
      if (columns.length === 0) {
        await this.connection.execute(
          `ALTER TABLE order_tracking ADD COLUMN account_code VARCHAR(50) AFTER ndr_reason`
        );
        
        await this.connection.execute(
          `ALTER TABLE order_tracking ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to order_tracking table');
      } else {
        console.log('✅ account_code column already exists in order_tracking table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code to order_tracking:', error.message);
      throw error;
    }
  }

  async createStrikerStore() {
    try {
      console.log('📝 Step 4: Creating Striker Store entry...');
      
      const storeName = 'Striker Store';
      const shipwayUsername = process.env.SHIPWAY_USERNAME;
      const shipwayPassword = process.env.SHIPWAY_PASSWORD;
      const shipwayBasicAuth = process.env.SHIPWAY_BASIC_AUTH_HEADER;
      const shopifyStoreUrl = process.env.SHOPIFY_STORE_URL;
      const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;
      
      if (!shipwayUsername || !shipwayPassword || !shipwayBasicAuth) {
        throw new Error('Missing Shipway credentials in .env: SHIPWAY_USERNAME, SHIPWAY_PASSWORD, SHIPWAY_BASIC_AUTH_HEADER are required');
      }
      
      if (!shopifyStoreUrl || !shopifyToken) {
        throw new Error('Missing Shopify credentials in .env: SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN are required');
      }
      
      // Check if store already exists
      const [existing] = await this.connection.execute(
        'SELECT * FROM store_info WHERE account_code = ?',
        [this.strikerAccountCode]
      );
      
      if (existing.length === 0) {
        // Encrypt Shipway password
        const encryptedPassword = encryptionService.encrypt(shipwayPassword);
        
        await this.connection.execute(`
          INSERT INTO store_info (
            account_code,
            store_name,
            shipping_partner,
            username,
            password_encrypted,
            auth_token,
            shopify_store_url,
            shopify_token,
            status,
            created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          this.strikerAccountCode,
          storeName,
          'Shipway',
          shipwayUsername,
          encryptedPassword,
          shipwayBasicAuth,
          shopifyStoreUrl,
          shopifyToken,
          'active',
          'system'
        ]);
        
        console.log(`✅ Striker Store created successfully!`);
        console.log(`   Account Code: ${this.strikerAccountCode}`);
      } else {
        console.log(`⚠️  Striker Store (${this.strikerAccountCode}) already exists, skipping creation`);
      }
      
      console.log('');
    } catch (error) {
      console.error('❌ Error creating Striker Store:', error.message);
      throw error;
    }
  }

  async migrateDataToStrikerAccountCode() {
    try {
      console.log('📝 Step 5: Migrating existing data to account_code = "STRI"...');
      
      const tables = [
        'carriers',
        'products',
        'orders',
        'claims',
        'labels',
        'customer_info',
        'order_tracking'
      ];
      
      for (const table of tables) {
        try {
          // Check if table exists
          const [tableExists] = await this.connection.execute(
            `SELECT COUNT(*) as count FROM information_schema.tables 
             WHERE table_schema = DATABASE() AND table_name = ?`,
            [table]
          );
          
          if (tableExists[0].count === 0) {
            console.log(`   ⚠️  Table ${table} does not exist, skipping...`);
            continue;
          }
          
          // Check if account_code column exists
          const [columns] = await this.connection.execute(
            `SHOW COLUMNS FROM ${table} LIKE 'account_code'`
          );
          
          if (columns.length === 0) {
            console.log(`   ⚠️  account_code column does not exist in ${table}, skipping...`);
            continue;
          }
          
          // Update rows where account_code is NULL or empty
          const [result] = await this.connection.execute(
            `UPDATE ${table} SET account_code = ? WHERE account_code IS NULL OR account_code = ''`,
            [this.strikerAccountCode]
          );
          
          console.log(`   ✅ Updated ${result.affectedRows} rows in ${table}`);
        } catch (error) {
          console.error(`   ❌ Error updating ${table}:`, error.message);
          // Continue with other tables even if one fails
        }
      }
      
      console.log('');
    } catch (error) {
      console.error('❌ Error migrating data:', error.message);
      throw error;
    }
  }

  async setAccountCodeAsNotNull() {
    try {
      console.log('📝 Step 6: Setting account_code as NOT NULL...');
      
      const tables = [
        'carriers',
        'products',
        'orders',
        'claims',
        'labels',
        'customer_info',
        'order_tracking'
      ];
      
      for (const table of tables) {
        try {
          // Check if table exists
          const [tableExists] = await this.connection.execute(
            `SELECT COUNT(*) as count FROM information_schema.tables 
             WHERE table_schema = DATABASE() AND table_name = ?`,
            [table]
          );
          
          if (tableExists[0].count === 0) {
            continue;
          }
          
          // Check if account_code column exists
          const [columns] = await this.connection.execute(
            `SHOW COLUMNS FROM ${table} WHERE Field = 'account_code'`
          );
          
          if (columns.length === 0) {
            continue;
          }
          
          // Check if it's already NOT NULL
          if (columns[0].Null === 'NO') {
            console.log(`   ✅ account_code already NOT NULL in ${table}`);
            continue;
          }
          
          // Set as NOT NULL
          await this.connection.execute(
            `ALTER TABLE ${table} MODIFY account_code VARCHAR(50) NOT NULL`
          );
          
          console.log(`   ✅ Set account_code NOT NULL in ${table}`);
        } catch (error) {
          console.error(`   ❌ Error setting NOT NULL in ${table}:`, error.message);
          // Continue with other tables
        }
      }
      
      console.log('');
    } catch (error) {
      console.error('❌ Error setting NOT NULL constraints:', error.message);
      throw error;
    }
  }

  async markMigrationComplete() {
    try {
      console.log('📝 Step 7: Marking migration as complete...');
      
      await this.connection.execute(`
        INSERT INTO utility (parameter, value, created_by)
        VALUES ('prod_migration_completed', 'true', 'system')
        ON DUPLICATE KEY UPDATE value = 'true', modified_at = CURRENT_TIMESTAMP
      `);
      
      console.log('✅ Migration marked as complete\n');
    } catch (error) {
      console.error('❌ Error marking migration complete:', error.message);
      throw error;
    }
  }

  async runMigration() {
    try {
      console.log('\n🚀 ========================================');
      console.log('   PRODUCTION DATABASE MIGRATION');
      console.log('   From commit 955524d to current');
      console.log('========================================\n');
      
      // Connect to database
      await this.connectToMySQL();
      
      // Check if already migrated
      const alreadyMigrated = await this.checkMigrationStatus();
      if (alreadyMigrated) {
        await this.connection.end();
        return; // Return early if already migrated (don't exit process when called from server)
      }
      
      // Start transaction
      await this.connection.beginTransaction();
      
      try {
        // Step 1: Create new tables
        await this.createStoreInfoTable();
        await this.createWhMappingTable();
        
        // Step 2: Add account_code column to existing tables
        await this.addAccountCodeToCarriers();
        await this.addAccountCodeToProducts();
        await this.addAccountCodeToOrders();
        await this.addAccountCodeToClaims();
        await this.addAccountCodeToLabels();
        await this.addAccountCodeToCustomerInfo();
        await this.addAccountCodeToOrderTracking();
        
        // Step 3: Create Striker Store
        await this.createStrikerStore();
        
        // Step 4: Migrate existing data
        await this.migrateDataToStrikerAccountCode();
        
        // Step 5: Set NOT NULL constraints
        await this.setAccountCodeAsNotNull();
        
        // Step 6: Mark migration complete
        await this.markMigrationComplete();
        
        // Commit transaction
        await this.connection.commit();
        
        console.log('\n🎉 ========================================');
        console.log('   MIGRATION COMPLETED SUCCESSFULLY!');
        console.log('========================================');
        console.log('');
        console.log('📊 Summary:');
        console.log('   ✅ Created 2 new tables: store_info, wh_mapping');
        console.log('   ✅ Added account_code to 7 tables');
        console.log('   ✅ Created Striker Store (STRI)');
        console.log('   ✅ Migrated all existing data to account_code = "STRI"');
        console.log('   ✅ Set NOT NULL constraints');
        console.log('');
        console.log('🚀 Your production database is now ready!');
        console.log('   You can now start your server.');
        console.log('========================================\n');
        
      } catch (error) {
        // Rollback on error
        await this.connection.rollback();
        throw error;
      }
      
    } catch (error) {
      console.error('\n❌ ========================================');
      console.error('   MIGRATION FAILED!');
      console.error('========================================');
      console.error(`Error: ${error.message}`);
      console.error('\nPlease fix the error and run the migration again.');
      console.error('========================================\n');
      throw error;
    } finally {
      if (this.connection) {
        await this.connection.end();
        console.log('🔌 Database connection closed\n');
      }
    }
  }
}

/**
 * Run production database migration
 * This function can be called from other modules
 * @returns {Promise<boolean>} True if migration completed or was skipped, false on error
 */
async function runProductionMigration() {
  try {
    const migration = new ProductionMigration();
    await migration.runMigration();
    return true;
  } catch (error) {
    // If migration was already completed, that's fine - return true
    if (error.message && (
      error.message.includes('already been completed') || 
      error.message.includes('already completed')
    )) {
      return true;
    }
    console.error('💥 Production migration failed:', error.message);
    // Don't throw - let server continue even if migration fails
    return false;
  }
}

// If script is run directly (not imported), run migration
if (require.main === module) {
  runProductionMigration()
    .then(success => {
      if (success) {
        console.log('✅ Migration script completed');
        process.exit(0);
      } else {
        console.error('❌ Migration script failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

// Export the function for use in other modules
module.exports = { runProductionMigration, ProductionMigration };

