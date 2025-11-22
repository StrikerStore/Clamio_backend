/**
 * Migration Script: Increase id column size in orders table
 * 
 * This script increases the id column from VARCHAR(50) to VARCHAR(255)
 * to accommodate longer order IDs that include order_id, product_code, and timestamp.
 * 
 * Usage: node backend/scripts/migrate-id-column-size.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'clamio_db',
  charset: 'utf8mb4'
};

async function runMigration() {
  let connection;
  
  try {
    console.log('🚀 Starting migration: Increase id column size in orders table');
    console.log('⚠️  IMPORTANT: Make sure you have a database backup before proceeding!');
    
    // Connect to database
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Connected to database');
    
    // Step 1: Check current table structure
    console.log('\n📋 Step 1: Checking current table structure...');
    const [tables] = await connection.execute("SHOW TABLES LIKE 'orders'");
    if (tables.length === 0) {
      throw new Error('Orders table not found');
    }
    console.log('✅ Orders table found');
    
    // Step 2: Check current id column size
    console.log('\n🔍 Step 2: Checking current id column size...');
    const [columns] = await connection.execute(
      "SHOW COLUMNS FROM orders WHERE Field = 'id'"
    );
    
    if (columns.length === 0) {
      throw new Error('id column not found in orders table');
    }
    
    const idColumn = columns[0];
    const currentType = idColumn.Type.toUpperCase();
    console.log(`- Current id column type: ${currentType}`);
    
    // Step 3: Extract current size
    const match = currentType.match(/VARCHAR\((\d+)\)/);
    if (!match) {
      throw new Error(`Unexpected id column type: ${currentType}. Expected VARCHAR(n)`);
    }
    
    const currentSize = parseInt(match[1]);
    console.log(`- Current id column size: VARCHAR(${currentSize})`);
    
    // Step 4: Check if migration is needed
    if (currentSize >= 255) {
      console.log('\n✅ Migration not needed: id column is already VARCHAR(255) or larger');
      console.log('🎉 Migration completed (no changes required)');
      return;
    }
    
    // Step 5: Perform migration
    console.log(`\n🔄 Step 3: Increasing id column size from VARCHAR(${currentSize}) to VARCHAR(255)...`);
    
    // Note: Don't specify PRIMARY KEY here - MySQL preserves it when modifying the column
    await connection.execute(
      `ALTER TABLE orders MODIFY COLUMN id VARCHAR(255)`
    );
    
    console.log('✅ id column size increased to VARCHAR(255)');
    
    // Step 6: Verify migration
    console.log('\n🔍 Step 4: Verifying migration...');
    const [updatedColumns] = await connection.execute(
      "SHOW COLUMNS FROM orders WHERE Field = 'id'"
    );
    
    if (updatedColumns.length > 0) {
      const updatedType = updatedColumns[0].Type.toUpperCase();
      const updatedMatch = updatedType.match(/VARCHAR\((\d+)\)/);
      if (updatedMatch && parseInt(updatedMatch[1]) >= 255) {
        console.log(`✅ Verification successful: id column is now ${updatedType}`);
        console.log('🎉 Migration completed successfully!');
      } else {
        throw new Error(`Migration verification failed: id column is ${updatedType}`);
      }
    } else {
      throw new Error('Migration verification failed: id column not found after migration');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('\n✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };

