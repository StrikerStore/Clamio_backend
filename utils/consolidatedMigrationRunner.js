/**
 * Consolidated Migration Runner
 * 
 * This script consolidates all recent database changes:
 * 1. Verifies wh_mapping table columns (return_warehouse_id, pickup_location)
 * 2. Verifies orders table columns (size, shipment_id, channel_id, partner_order_id)
 * 3. Runs product resync once (to update sizes with decimal handling)
 * 4. Updates ShipmentStatusMapping from CSV file
 * 
 * This migration is designed to run ONCE on production deployment.
 * All steps are idempotent (safe to run multiple times).
 * 
 * After successful completion, this script can be removed from code.
 */

const database = require('../config/database');
const fs = require('fs');
const path = require('path');
const { resyncProductsAndUpdateSizes } = require('../scripts/resync-products-and-update-sizes');

// Valid color values based on frontend color mapping
const VALID_COLORS = ['blue', 'orange', 'yellow', 'green', 'red', 'maroon'];

/**
 * Parse CSV file and convert to JSON array
 */
function parseCSV(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row');
    }

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim());
    const expectedHeaders = ['raw', 'renamed', 'color', 'is_handover'];
    
    // Validate headers
    const missingHeaders = expectedHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
    }

    // Parse data rows
    const mapping = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle CSV parsing (simple split, but handle quoted values)
      const values = [];
      let currentValue = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim()); // Add last value
      
      if (values.length < 4) {
        errors.push(`Line ${i + 1}: Insufficient columns (expected 4, got ${values.length})`);
        continue;
      }

      const raw = values[0];
      const renamed = values[1];
      const color = values[2].toLowerCase();
      const isHandover = values[3].toLowerCase();

      // Validate required fields
      if (!raw || !renamed) {
        errors.push(`Line ${i + 1}: Missing raw or renamed value`);
        continue;
      }

      // Validate color
      if (!VALID_COLORS.includes(color)) {
        errors.push(`Line ${i + 1}: Invalid color "${color}". Must be one of: ${VALID_COLORS.join(', ')}`);
        continue;
      }

      // Validate is_handover (should be 0 or 1)
      const isHandoverNum = isHandover === '1' || isHandover === 'true' ? 1 : 0;

      mapping.push({
        raw: raw,
        renamed: renamed,
        color: color,
        is_handover: isHandoverNum
      });
    }

    if (errors.length > 0) {
      console.warn('⚠️  CSV parsing warnings:');
      errors.forEach(err => console.warn(`   ${err}`));
    }

    return mapping;
  } catch (error) {
    throw new Error(`Failed to parse CSV file: ${error.message}`);
  }
}

/**
 * Check if migration has already been completed
 */
async function isMigrationCompleted() {
  try {
    const [rows] = await database.mysqlConnection.execute(
      `SELECT value FROM utility WHERE parameter = 'ConsolidatedMigration_v1'`
    );
    return rows.length > 0 && rows[0].value === 'completed';
  } catch (error) {
    return false;
  }
}

/**
 * Mark migration as completed
 */
async function markMigrationCompleted() {
  try {
    await database.mysqlConnection.execute(
      `INSERT INTO utility (parameter, value, created_by) 
       VALUES ('ConsolidatedMigration_v1', 'completed', 'system')
       ON DUPLICATE KEY UPDATE value = 'completed', updated_at = CURRENT_TIMESTAMP`
    );
  } catch (error) {
    console.error('⚠️  Error marking migration as completed:', error.message);
  }
}

/**
 * Step 1: Verify wh_mapping table columns
 */
async function verifyWhMappingColumns() {
  console.log('📋 Step 1: Verifying wh_mapping table columns...');
  
  try {
    // Check return_warehouse_id column
    const [returnWhCols] = await database.mysqlConnection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'wh_mapping' 
      AND COLUMN_NAME = 'return_warehouse_id'
    `);

    if (returnWhCols.length === 0) {
      console.log('   🔄 Adding return_warehouse_id column...');
      await database.mysqlConnection.execute(`
        ALTER TABLE wh_mapping 
        ADD COLUMN return_warehouse_id VARCHAR(50) AFTER account_code
      `);
      console.log('   ✅ Added return_warehouse_id column');
    } else {
      console.log('   ✅ return_warehouse_id column already exists');
    }

    // Check pickup_location column
    const [pickupLocCols] = await database.mysqlConnection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'wh_mapping' 
      AND COLUMN_NAME = 'pickup_location'
    `);

    if (pickupLocCols.length === 0) {
      console.log('   🔄 Adding pickup_location column...');
      await database.mysqlConnection.execute(`
        ALTER TABLE wh_mapping 
        ADD COLUMN pickup_location VARCHAR(255) AFTER return_warehouse_id
      `);
      console.log('   ✅ Added pickup_location column');
    } else {
      console.log('   ✅ pickup_location column already exists');
    }

    console.log('✅ Step 1 completed: wh_mapping columns verified\n');
  } catch (error) {
    console.error('❌ Error in Step 1:', error.message);
    throw error;
  }
}

/**
 * Step 2: Verify orders table columns
 */
async function verifyOrdersColumns() {
  console.log('📋 Step 2: Verifying orders table columns...');
  
  try {
    const columnsToCheck = [
      { name: 'size', type: 'VARCHAR(20)', after: 'product_code' },
      { name: 'shipment_id', type: 'VARCHAR(100)', after: 'unique_id' },
      { name: 'channel_id', type: 'VARCHAR(100)', after: 'shipment_id' },
      { name: 'partner_order_id', type: 'VARCHAR(100)', after: 'channel_id' }
    ];

    for (const col of columnsToCheck) {
      const [cols] = await database.mysqlConnection.execute(
        `SHOW COLUMNS FROM orders LIKE ?`,
        [col.name]
      );

      if (cols.length === 0) {
        console.log(`   🔄 Adding ${col.name} column...`);
        await database.mysqlConnection.execute(
          `ALTER TABLE orders ADD COLUMN ${col.name} ${col.type} AFTER ${col.after}`
        );
        
        // Add index for shipment_id, channel_id, partner_order_id
        if (['shipment_id', 'channel_id', 'partner_order_id'].includes(col.name)) {
          await database.mysqlConnection.execute(
            `ALTER TABLE orders ADD INDEX idx_${col.name} (${col.name})`
          );
        }
        
        console.log(`   ✅ Added ${col.name} column`);
      } else {
        console.log(`   ✅ ${col.name} column already exists`);
      }
    }

    console.log('✅ Step 2 completed: orders table columns verified\n');
  } catch (error) {
    console.error('❌ Error in Step 2:', error.message);
    throw error;
  }
}

/**
 * Step 3: Run product resync (only once)
 */
async function runProductResync() {
  console.log('📋 Step 3: Running product resync (one-time)...');
  
  try {
    // Check if product resync has already been completed
    const [rows] = await database.mysqlConnection.execute(
      `SELECT value FROM utility WHERE parameter = 'ProductResyncCompleted'`
    );
    
    if (rows.length > 0 && rows[0].value === 'completed') {
      console.log('   ⏭️  Product resync already completed, skipping...');
      console.log('✅ Step 3 completed: Product resync skipped (already done)\n');
      return;
    }

    console.log('   🔄 Starting product resync and size update...');
    await resyncProductsAndUpdateSizes();
    
    // Mark as completed
    await database.mysqlConnection.execute(
      `INSERT INTO utility (parameter, value, created_by) 
       VALUES ('ProductResyncCompleted', 'completed', 'system')
       ON DUPLICATE KEY UPDATE value = 'completed', updated_at = CURRENT_TIMESTAMP`
    );
    
    console.log('✅ Step 3 completed: Product resync finished\n');
  } catch (error) {
    console.error('❌ Error in Step 3:', error.message);
    // Don't throw - allow migration to continue even if resync fails
    console.warn('⚠️  Continuing migration despite product resync error...\n');
  }
}

/**
 * Step 4: Update ShipmentStatusMapping from CSV
 */
async function updateShipmentStatusMapping() {
  console.log('📋 Step 4: Updating ShipmentStatusMapping from CSV...');
  
  try {
    // Path to CSV file (in backend/data directory)
    const csvFilePath = path.join(__dirname, '..', 'data', 'shipment-status-mapping-final.csv');
    
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at: ${csvFilePath}`);
    }
    
    const filePath = csvFilePath;

    console.log(`   📄 Reading CSV file: ${filePath}`);
    const mapping = parseCSV(filePath);
    console.log(`   ✅ Parsed ${mapping.length} status mappings`);

    // Update database
    const mappingJson = JSON.stringify(mapping);
    await database.setUtilityValue('ShipmentStatusMapping', mappingJson, 'migration');
    
    // Clear cache
    database.clearShipmentStatusMappingCache();
    
    console.log(`✅ Step 4 completed: ShipmentStatusMapping updated with ${mapping.length} entries\n`);
  } catch (error) {
    console.error('❌ Error in Step 4:', error.message);
    throw error;
  }
}

/**
 * Main migration function
 */
async function runConsolidatedMigration() {
  try {
    console.log('\n🚀 ========================================');
    console.log('   CONSOLIDATED MIGRATION v1');
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

    // Check if migration already completed
    if (await isMigrationCompleted()) {
      console.log('✅ Consolidated migration already completed. Skipping...\n');
      return true;
    }

    // Run all migration steps
    await verifyWhMappingColumns();
    await verifyOrdersColumns();
    await runProductResync();
    await updateShipmentStatusMapping();

    // Mark migration as completed
    await markMigrationCompleted();

    console.log('════════════════════════════════════════════════════════════');
    console.log('🎉 CONSOLIDATED MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('════════════════════════════════════════════════════════════\n');

    return true;
  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('   CONSOLIDATED MIGRATION FAILED');
    console.error('========================================');
    console.error(`Error: ${error.message}`);
    console.error('========================================\n');
    return false;
  }
}

module.exports = { runConsolidatedMigration };
