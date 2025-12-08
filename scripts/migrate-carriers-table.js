/**
 * Carriers Table Migration Script
 * 
 * This script migrates the carriers table structure and data:
 * 1. Drops old UNIQUE constraint on carrier_id
 * 2. Adds account_code column if not exists
 * 3. Adds new composite UNIQUE constraint (carrier_id, account_code)
 * 4. Fetches carriers from all active stores
 * 5. Stores carriers with proper account_code
 * 
 * This script should be run on server startup to ensure carriers are properly migrated.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const database = require('../config/database');
const shipwayCarrierServiceModule = require('../services/shipwayCarrierService');
const ShipwayCarrierService = shipwayCarrierServiceModule.ShipwayCarrierService || shipwayCarrierServiceModule;

class CarriersMigration {
  constructor() {
    this.dbConfig = {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };
    this.connection = null;
  }

  async connectToMySQL() {
    try {
      console.log('🔗 Connecting to MySQL...');
      
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
        `SELECT value FROM utility WHERE parameter = 'carriers_migration_completed'`
      );
      
      if (result.length > 0 && result[0].value === 'true') {
        console.log('✅ Carriers migration has already been completed!');
        console.log('   Skipping migration (already done).\n');
        return true;
      }
      
      return false;
    } catch (error) {
      // Utility table might not have the parameter yet, which is fine
      return false;
    }
  }

  async dropOldUniqueConstraint() {
    try {
      console.log('📝 Step 1: Checking and dropping old UNIQUE constraint on carrier_id...');
      
      // Check if old unique constraint exists
      const [constraints] = await this.connection.execute(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.TABLE_CONSTRAINTS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'carriers' 
        AND CONSTRAINT_TYPE = 'UNIQUE'
        AND CONSTRAINT_NAME != 'unique_carrier_store'
      `);
      
      if (constraints.length > 0) {
        // Find constraint on carrier_id column
        for (const constraint of constraints) {
          const [keyUsage] = await this.connection.execute(`
            SELECT COLUMN_NAME 
            FROM information_schema.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'carriers' 
            AND CONSTRAINT_NAME = ?
            AND COLUMN_NAME = 'carrier_id'
          `, [constraint.CONSTRAINT_NAME]);
          
          if (keyUsage.length > 0) {
            console.log(`   Dropping old UNIQUE constraint: ${constraint.CONSTRAINT_NAME}`);
            await this.connection.execute(
              `ALTER TABLE carriers DROP INDEX ${constraint.CONSTRAINT_NAME}`
            );
            console.log(`   ✅ Dropped old UNIQUE constraint: ${constraint.CONSTRAINT_NAME}`);
          }
        }
      } else {
        console.log('   ℹ️  No old UNIQUE constraint found (may have been removed already)');
      }
      
      console.log('');
    } catch (error) {
      // If constraint doesn't exist, that's fine
      if (error.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
        console.log('   ℹ️  Old UNIQUE constraint not found (already removed or never existed)');
      } else {
        console.error('   ⚠️  Error checking/dropping old constraint:', error.message);
        // Continue anyway - not critical
      }
    }
  }

  async addAccountCodeColumn() {
    try {
      console.log('📝 Step 2: Adding account_code column to carriers table...');
      
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM carriers LIKE 'account_code'`
      );
      
      if (columns.length === 0) {
        // Add column as nullable first (we'll set values later)
        await this.connection.execute(
          `ALTER TABLE carriers ADD COLUMN account_code VARCHAR(50) AFTER priority`
        );
        
        // Add index
        await this.connection.execute(
          `ALTER TABLE carriers ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('   ✅ account_code column added to carriers table');
      } else {
        console.log('   ✅ account_code column already exists in carriers table');
      }
      
      console.log('');
    } catch (error) {
      console.error('   ❌ Error adding account_code column:', error.message);
      throw error;
    }
  }

  async addCompositeUniqueConstraint() {
    try {
      console.log('📝 Step 3: Adding composite UNIQUE constraint (carrier_id, account_code)...');
      
      // Check if constraint already exists
      const [constraints] = await this.connection.execute(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.TABLE_CONSTRAINTS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'carriers' 
        AND CONSTRAINT_NAME = 'unique_carrier_store'
      `);
      
      if (constraints.length === 0) {
        await this.connection.execute(
          `ALTER TABLE carriers ADD UNIQUE KEY unique_carrier_store (carrier_id, account_code)`
        );
        console.log('   ✅ Composite UNIQUE constraint added');
      } else {
        console.log('   ✅ Composite UNIQUE constraint already exists');
      }
      
      console.log('');
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_DUP_KEYNAME') {
        console.log('   ℹ️  Composite UNIQUE constraint already exists');
      } else {
        console.error('   ❌ Error adding composite UNIQUE constraint:', error.message);
        throw error;
      }
    }
  }

  async getAllActiveStores() {
    try {
      console.log('📝 Step 4: Fetching all active stores...');
      
      const [stores] = await this.connection.execute(
        `SELECT * FROM store_info WHERE status = 'active'`
      );
      
      console.log(`   ✅ Found ${stores.length} active store(s)`);
      console.log('');
      
      return stores;
    } catch (error) {
      console.error('   ❌ Error fetching active stores:', error.message);
      throw error;
    }
  }

  async fetchAndStoreCarriersForStore(store) {
    try {
      console.log(`   🔄 Processing store: ${store.store_name} (${store.account_code})...`);
      
      // Initialize carrier service for this store
      const carrierService = new ShipwayCarrierService(store.account_code);
      await carrierService.initialize();
      
      // Fetch carriers from Shipway API
      const shipwayData = await carrierService.fetchCarriersFromShipway();
      
      // Extract carrier data
      const carriers = carrierService.extractCarrierData(shipwayData);
      
      if (carriers.length === 0) {
        console.log(`   ⚠️  No carriers found for store: ${store.account_code}`);
        return { success: true, count: 0, inserted: 0, updated: 0 };
      }
      
      // Store carriers with account_code
      let inserted = 0;
      let updated = 0;
      
      for (const carrier of carriers) {
        try {
          // Check if carrier exists for this account_code
          const [existing] = await this.connection.execute(
            `SELECT id FROM carriers WHERE carrier_id = ? AND account_code = ?`,
            [carrier.carrier_id, store.account_code]
          );
          
          if (existing.length > 0) {
            // Update existing carrier
            await this.connection.execute(
              `UPDATE carriers 
               SET carrier_name = ?, status = ?, weight_in_kg = ?, priority = ?, updated_at = CURRENT_TIMESTAMP
               WHERE carrier_id = ? AND account_code = ?`,
              [
                carrier.carrier_name,
                carrier.status || 'Active',
                carrier.weight_in_kg || null,
                carrier.priority || 0,
                carrier.carrier_id,
                store.account_code
              ]
            );
            updated++;
          } else {
            // Insert new carrier
            await this.connection.execute(
              `INSERT INTO carriers (carrier_id, carrier_name, status, weight_in_kg, priority, account_code)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                carrier.carrier_id,
                carrier.carrier_name,
                carrier.status || 'Active',
                carrier.weight_in_kg || null,
                carrier.priority || 0,
                store.account_code
              ]
            );
            inserted++;
          }
        } catch (error) {
          // Skip duplicate entries (might happen during concurrent runs)
          if (error.code === 'ER_DUP_ENTRY') {
            console.log(`     ⚠️  Duplicate carrier skipped: ${carrier.carrier_id} for ${store.account_code}`);
            continue;
          }
          console.error(`     ❌ Error processing carrier ${carrier.carrier_id}:`, error.message);
        }
      }
      
      console.log(`   ✅ Store ${store.account_code}: ${inserted} inserted, ${updated} updated`);
      
      return { success: true, count: carriers.length, inserted, updated };
    } catch (error) {
      console.error(`   ❌ Error processing store ${store.account_code}:`, error.message);
      // Continue with other stores even if one fails
      return { success: false, error: error.message };
    }
  }

  async migrateExistingCarriersData() {
    try {
      console.log('📝 Step 5: Migrating existing carriers data...');
      
      // Get all carriers without account_code
      const [carriersWithoutAccountCode] = await this.connection.execute(
        `SELECT * FROM carriers WHERE account_code IS NULL OR account_code = ''`
      );
      
      if (carriersWithoutAccountCode.length === 0) {
        console.log('   ✅ No carriers without account_code found');
        console.log('');
        return;
      }
      
      console.log(`   Found ${carriersWithoutAccountCode.length} carriers without account_code`);
      
      // Get the default store (Striker Store - STRI)
      const [defaultStore] = await this.connection.execute(
        `SELECT account_code FROM store_info WHERE store_name = 'Striker Store' LIMIT 1`
      );
      
      if (defaultStore.length === 0) {
        console.log('   ⚠️  No default store found, skipping data migration');
        console.log('   ℹ️  Carriers will be fetched from active stores in next step');
        console.log('');
        return;
      }
      
      const defaultAccountCode = defaultStore[0].account_code;
      console.log(`   Assigning default account_code: ${defaultAccountCode}`);
      
      // Update carriers without account_code
      const [result] = await this.connection.execute(
        `UPDATE carriers SET account_code = ? WHERE account_code IS NULL OR account_code = ''`,
        [defaultAccountCode]
      );
      
      console.log(`   ✅ Updated ${result.affectedRows} carriers with default account_code`);
      console.log('');
    } catch (error) {
      console.error('   ❌ Error migrating existing carriers data:', error.message);
      // Continue anyway - not critical
    }
  }

  async setAccountCodeAsNotNull() {
    try {
      console.log('📝 Step 6: Setting account_code as NOT NULL...');
      
      // Check if it's already NOT NULL
      const [columns] = await this.connection.execute(
        `SHOW COLUMNS FROM carriers WHERE Field = 'account_code'`
      );
      
      if (columns.length > 0 && columns[0].Null === 'NO') {
        console.log('   ✅ account_code already NOT NULL');
        console.log('');
        return;
      }
      
      // Set as NOT NULL
      await this.connection.execute(
        `ALTER TABLE carriers MODIFY account_code VARCHAR(50) NOT NULL`
      );
      
      console.log('   ✅ Set account_code as NOT NULL');
      console.log('');
    } catch (error) {
      console.error('   ❌ Error setting NOT NULL constraint:', error.message);
      throw error;
    }
  }

  async markMigrationComplete() {
    try {
      console.log('📝 Step 7: Marking migration as complete...');
      
      await this.connection.execute(`
        INSERT INTO utility (parameter, value, created_by)
        VALUES ('carriers_migration_completed', 'true', 'system')
        ON DUPLICATE KEY UPDATE value = 'true', modified_at = CURRENT_TIMESTAMP
      `);
      
      console.log('   ✅ Migration marked as complete\n');
    } catch (error) {
      console.error('   ❌ Error marking migration complete:', error.message);
      throw error;
    }
  }

  async runMigration() {
    try {
      console.log('\n🚀 ========================================');
      console.log('   CARRIERS TABLE MIGRATION');
      console.log('========================================\n');
      
      // Connect to database
      await this.connectToMySQL();
      
      // Check if already migrated
      const alreadyMigrated = await this.checkMigrationStatus();
      if (alreadyMigrated) {
        await this.connection.end();
        return; // Return early if already migrated
      }
      
      // Start transaction
      await this.connection.beginTransaction();
      
      try {
        // Step 1: Drop old unique constraint
        await this.dropOldUniqueConstraint();
        
        // Step 2: Add account_code column
        await this.addAccountCodeColumn();
        
        // Step 3: Migrate existing data (assign default account_code)
        await this.migrateExistingCarriersData();
        
        // Step 4: Add composite unique constraint
        await this.addCompositeUniqueConstraint();
        
        // Step 5: Fetch and store carriers from all active stores
        const stores = await this.getAllActiveStores();
        
        if (stores.length > 0) {
          console.log('📝 Step 5: Fetching carriers from active stores...');
          let totalInserted = 0;
          let totalUpdated = 0;
          let totalStores = 0;
          
          for (const store of stores) {
            const result = await this.fetchAndStoreCarriersForStore(store);
            if (result.success) {
              totalInserted += result.inserted || 0;
              totalUpdated += result.updated || 0;
              totalStores++;
            }
          }
          
          console.log(`\n   ✅ Processed ${totalStores} store(s)`);
          console.log(`   ✅ Total: ${totalInserted} inserted, ${totalUpdated} updated`);
          console.log('');
        } else {
          console.log('   ⚠️  No active stores found, skipping carrier fetch');
          console.log('');
        }
        
        // Step 6: Set NOT NULL constraint
        await this.setAccountCodeAsNotNull();
        
        // Step 7: Mark migration complete
        await this.markMigrationComplete();
        
        // Commit transaction
        await this.connection.commit();
        
        console.log('\n🎉 ========================================');
        console.log('   CARRIERS MIGRATION COMPLETED!');
        console.log('========================================');
        console.log('');
        console.log('📊 Summary:');
        console.log('   ✅ Dropped old UNIQUE constraint on carrier_id');
        console.log('   ✅ Added account_code column');
        console.log('   ✅ Added composite UNIQUE constraint (carrier_id, account_code)');
        console.log('   ✅ Migrated existing carriers data');
        console.log('   ✅ Fetched carriers from all active stores');
        console.log('   ✅ Set NOT NULL constraints');
        console.log('');
        console.log('🚀 Carriers table is now ready for multi-store!');
        console.log('========================================\n');
        
      } catch (error) {
        // Rollback on error
        await this.connection.rollback();
        throw error;
      }
      
    } catch (error) {
      console.error('\n❌ ========================================');
      console.error('   CARRIERS MIGRATION FAILED!');
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
 * Run carriers table migration
 * This function can be called from other modules
 * @returns {Promise<boolean>} True if migration completed or was skipped, false on error
 */
async function runCarriersMigration() {
  try {
    const migration = new CarriersMigration();
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
    console.error('💥 Carriers migration failed:', error.message);
    // Don't throw - let server continue even if migration fails
    return false;
  }
}

// If script is run directly (not imported), run migration
if (require.main === module) {
  runCarriersMigration()
    .then(success => {
      if (success) {
        console.log('✅ Carriers migration script completed');
        process.exit(0);
      } else {
        console.error('❌ Carriers migration script failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Carriers migration script failed:', error);
      process.exit(1);
    });
}

// Export the function for use in other modules
module.exports = { runCarriersMigration, CarriersMigration };

