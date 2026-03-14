/**
 * Migration Script: Create wh_mapping table
 * 
 * This script creates the wh_mapping table for mapping claimio warehouse IDs
 * to vendor warehouse IDs (shipping partner warehouse IDs) per account_code.
 * 
 * Run with: node backend/scripts/migrate-wh-mapping-table.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migrateWhMappingTable() {
  let connection = null;

  try {
    console.log('🔄 Starting wh_mapping table migration...');

    // Get database configuration
    const dbConfig = {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };

    // Validate required environment variables
    if (!dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database) {
      throw new Error('Missing required database environment variables: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
    }

    // Connect to database
    connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database
    });

    console.log('✅ Connected to database');

    // Check if table already exists
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'wh_mapping'"
    );

    if (tables.length > 0) {
      console.log('ℹ️  wh_mapping table already exists, skipping creation');
      
      // Check if all required columns exist
      const [columns] = await connection.execute(
        "SHOW COLUMNS FROM wh_mapping"
      );
      
      const columnNames = columns.map(col => col.Field);
      const requiredColumns = ['id', 'claimio_wh_id', 'vendor_wh_id', 'account_code', 'is_active', 'created_at', 'modified_at'];
      const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));
      
      if (missingColumns.length > 0) {
        console.log(`⚠️  Missing columns: ${missingColumns.join(', ')}`);
        console.log('   Please check the table structure manually');
      } else {
        console.log('✅ All required columns exist');
      }
      
      await connection.end();
      return;
    }

    // Create wh_mapping table
    console.log('📦 Creating wh_mapping table...');
    
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS wh_mapping (
        id INT AUTO_INCREMENT PRIMARY KEY,
        claimio_wh_id VARCHAR(50) NOT NULL,
        vendor_wh_id VARCHAR(50) NOT NULL,
        account_code VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_claimio_wh_id (claimio_wh_id),
        INDEX idx_account_code (account_code),
        INDEX idx_is_active (is_active),
        INDEX idx_claimio_account (claimio_wh_id, account_code),
        FOREIGN KEY (account_code) REFERENCES store_info(account_code) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    await connection.execute(createTableQuery);
    console.log('✅ wh_mapping table created successfully');

    // Verify table creation
    const [verifyColumns] = await connection.execute(
      "SHOW COLUMNS FROM wh_mapping"
    );
    console.log(`✅ Table verified with ${verifyColumns.length} columns`);

    await connection.end();
    console.log('🎉 Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (connection) {
      await connection.end();
    }
    process.exit(1);
  }
}

// Run migration
migrateWhMappingTable();

