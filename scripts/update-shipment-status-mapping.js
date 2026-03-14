const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

/**
 * Script to update ShipmentStatusMapping from CSV file
 * 
 * Usage: node scripts/update-shipment-status-mapping.js <path-to-csv-file>
 * Example: node scripts/update-shipment-status-mapping.js "c:\Users\MOHIT\Downloads\shipment status mapping - final_mapping.csv"
 */

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

      if (values.length !== expectedHeaders.length) {
        errors.push(`Row ${i + 1}: Expected ${expectedHeaders.length} columns, got ${values.length}`);
        continue;
      }

      const raw = values[headers.indexOf('raw')];
      const renamed = values[headers.indexOf('renamed')];
      const color = values[headers.indexOf('color')];
      const is_handover = values[headers.indexOf('is_handover')];

      // Validate required fields
      if (!raw || !renamed || !color || is_handover === undefined || is_handover === '') {
        errors.push(`Row ${i + 1}: Missing required fields`);
        continue;
      }

      // Validate color
      if (!VALID_COLORS.includes(color.toLowerCase())) {
        errors.push(`Row ${i + 1}: Invalid color "${color}". Valid colors: ${VALID_COLORS.join(', ')}`);
        continue;
      }

      // Validate is_handover (should be 0 or 1)
      const isHandoverNum = parseInt(is_handover, 10);
      if (isNaN(isHandoverNum) || (isHandoverNum !== 0 && isHandoverNum !== 1)) {
        errors.push(`Row ${i + 1}: is_handover must be 0 or 1, got "${is_handover}"`);
        continue;
      }

      mapping.push({
        raw: raw,
        renamed: renamed,
        color: color.toLowerCase(),
        is_handover: isHandoverNum
      });
    }

    if (errors.length > 0) {
      console.error('\n❌ Validation errors found:');
      errors.forEach(err => console.error(`   ${err}`));
      throw new Error(`Found ${errors.length} validation error(s)`);
    }

    return mapping;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Backup current mapping to a file
 */
async function backupCurrentMapping() {
  try {
    const currentMapping = await database.getShipmentStatusMapping();
    const backupPath = path.join(__dirname, '..', 'backups', `shipment-status-mapping-backup-${Date.now()}.json`);
    
    // Ensure backups directory exists
    const backupsDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    fs.writeFileSync(backupPath, JSON.stringify(currentMapping, null, 2), 'utf-8');
    console.log(`✅ Current mapping backed up to: ${backupPath}`);
    return backupPath;
  } catch (error) {
    console.warn(`⚠️  Could not backup current mapping: ${error.message}`);
    return null;
  }
}

/**
 * Main function
 */
async function updateShipmentStatusMapping() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('🚀 Updating Shipment Status Mapping from CSV');
  console.log('════════════════════════════════════════════════════════════\n');

  try {
    // Get CSV file path from command line argument
    const csvFilePath = process.argv[2];
    
    if (!csvFilePath) {
      console.error('❌ Error: CSV file path is required');
      console.log('\nUsage: node scripts/update-shipment-status-mapping.js <path-to-csv-file>');
      console.log('Example: node scripts/update-shipment-status-mapping.js "c:\\Users\\MOHIT\\Downloads\\shipment status mapping - final_mapping.csv"');
      process.exit(1);
    }

    // Check if file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`File not found: ${csvFilePath}`);
    }

    console.log(`📄 Reading CSV file: ${csvFilePath}\n`);

    // Parse CSV
    console.log('📋 Step 1: Parsing CSV file...');
    const mapping = parseCSV(csvFilePath);
    console.log(`✅ Parsed ${mapping.length} status mappings\n`);

    // Validate database connection
    console.log('📋 Step 2: Connecting to database...');
    await database.waitForMySQLInitialization();

    if (!database.isMySQLAvailable()) {
      throw new Error('Database connection not available');
    }
    console.log('✅ Database connection established\n');

    // Backup current mapping
    console.log('📋 Step 3: Backing up current mapping...');
    const backupPath = await backupCurrentMapping();
    console.log('');

    // Update database
    console.log('📋 Step 4: Updating database...');
    const mappingJson = JSON.stringify(mapping);
    await database.setUtilityValue('ShipmentStatusMapping', mappingJson, 'script');
    console.log(`✅ Updated ShipmentStatusMapping with ${mapping.length} entries\n`);

    // Clear cache
    console.log('📋 Step 5: Clearing cache...');
    database.clearShipmentStatusMappingCache();
    console.log('✅ Cache cleared\n');

    // Verify update
    console.log('📋 Step 6: Verifying update...');
    const updatedMapping = await database.getShipmentStatusMapping();
    if (updatedMapping.length === mapping.length) {
      console.log(`✅ Verification successful: ${updatedMapping.length} entries in database\n`);
    } else {
      console.warn(`⚠️  Warning: Expected ${mapping.length} entries, found ${updatedMapping.length}`);
    }

    console.log('════════════════════════════════════════════════════════════');
    console.log('🎉 Shipment Status Mapping Updated Successfully!');
    console.log('════════════════════════════════════════════════════════════');
    
    if (backupPath) {
      console.log(`\n💾 Backup saved at: ${backupPath}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('   ERROR UPDATING MAPPING');
    console.error('========================================');
    console.error(`Error: ${error.message}`);
    console.error('========================================\n');
    process.exit(1);
  }
}

// Run the script
updateShipmentStatusMapping();
