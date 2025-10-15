#!/usr/bin/env node

/**
 * Migration Script: Replace unique_id with id in orders table
 * 
 * This script migrates the orders table to use the 'id' column as the primary identifier
 * instead of 'unique_id'. It handles:
 * 1. Data migration (copy unique_id values to id where id is null/empty)
 * 2. Update foreign key references in claims table
 * 3. Update indexes
 * 4. Remove unique_id column
 * 
 * IMPORTANT: Backup your database before running this script!
 */

const mysql = require('mysql2/promise');
const path = require('path');

// Database configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'clamio_db',
  charset: 'utf8mb4'
};

async function runMigration() {
  let connection;
  
  try {
    console.log('🚀 Starting migration: Replace unique_id with id in orders table');
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
    
    const [columns] = await connection.execute("DESCRIBE orders");
    const hasIdColumn = columns.some(col => col.Field === 'id');
    const hasUniqueIdColumn = columns.some(col => col.Field === 'unique_id');
    
    console.log(`- Has 'id' column: ${hasIdColumn}`);
    console.log(`- Has 'unique_id' column: ${hasUniqueIdColumn}`);
    
    if (!hasIdColumn || !hasUniqueIdColumn) {
      throw new Error('Required columns (id or unique_id) not found in orders table');
    }
    
    // Step 2: Check for data integrity
    console.log('\n🔍 Step 2: Checking data integrity...');
    const [orderCount] = await connection.execute("SELECT COUNT(*) as count FROM orders");
    console.log(`- Total orders: ${orderCount[0].count}`);
    
    const [nullIdCount] = await connection.execute("SELECT COUNT(*) as count FROM orders WHERE id IS NULL OR id = ''");
    console.log(`- Orders with null/empty id: ${nullIdCount[0].count}`);
    
    const [nullUniqueIdCount] = await connection.execute("SELECT COUNT(*) as count FROM orders WHERE unique_id IS NULL OR unique_id = ''");
    console.log(`- Orders with null/empty unique_id: ${nullUniqueIdCount[0].count}`);
    
    // Step 3: Check claims table references
    console.log('\n🔗 Step 3: Checking claims table references...');
    const [claimsTables] = await connection.execute("SHOW TABLES LIKE 'claims'");
    if (claimsTables.length > 0) {
      const [claimsColumns] = await connection.execute("DESCRIBE claims");
      const hasOrderUniqueIdColumn = claimsColumns.some(col => col.Field === 'order_unique_id');
      
      if (hasOrderUniqueIdColumn) {
        const [claimsCount] = await connection.execute("SELECT COUNT(*) as count FROM claims");
        console.log(`- Total claims: ${claimsCount[0].count}`);
        
        const [orphanedClaims] = await connection.execute(`
          SELECT COUNT(*) as count FROM claims c 
          LEFT JOIN orders o ON c.order_unique_id = o.unique_id 
          WHERE o.unique_id IS NULL
        `);
        console.log(`- Orphaned claims (no matching order): ${orphanedClaims[0].count}`);
      }
    }
    
    // Step 4: Start transaction
    console.log('\n🔄 Step 4: Starting migration transaction...');
    await connection.beginTransaction();
    
    // Step 5: Update orders table - copy unique_id to id where id is null/empty
    console.log('\n📝 Step 5: Updating orders table...');
    const [updateResult] = await connection.execute(`
      UPDATE orders 
      SET id = unique_id 
      WHERE (id IS NULL OR id = '') AND unique_id IS NOT NULL AND unique_id != ''
    `);
    console.log(`- Updated ${updateResult.affectedRows} orders`);
    
    // Step 6: Update claims table to reference id instead of unique_id
    if (claimsTables.length > 0) {
      console.log('\n🔗 Step 6: Updating claims table references...');
      
      // First, add new column for order_id reference
      try {
        await connection.execute("ALTER TABLE claims ADD COLUMN order_id_ref VARCHAR(50)");
        console.log('- Added order_id_ref column to claims table');
      } catch (error) {
        if (!error.message.includes('Duplicate column name')) {
          throw error;
        }
        console.log('- order_id_ref column already exists');
      }
      
      // Update the new column with id values from orders
      const [claimsUpdateResult] = await connection.execute(`
        UPDATE claims c 
        JOIN orders o ON c.order_unique_id = o.unique_id 
        SET c.order_id_ref = o.id
      `);
      console.log(`- Updated ${claimsUpdateResult.affectedRows} claims with new order references`);
      
      // Drop old column and rename new one
      await connection.execute("ALTER TABLE claims DROP COLUMN order_unique_id");
      await connection.execute("ALTER TABLE claims CHANGE order_id_ref order_unique_id VARCHAR(50)");
      console.log('- Renamed order_id_ref to order_unique_id in claims table');
    }
    
    // Step 7: Update indexes
    console.log('\n📊 Step 7: Updating indexes...');
    
    // Drop unique_id index
    try {
      await connection.execute("ALTER TABLE orders DROP INDEX idx_unique_id");
      console.log('- Dropped idx_unique_id index');
    } catch (error) {
      console.log('- idx_unique_id index not found or already dropped');
    }
    
    // Ensure id column has proper index
    try {
      await connection.execute("ALTER TABLE orders ADD INDEX idx_id (id)");
      console.log('- Added idx_id index');
    } catch (error) {
      console.log('- idx_id index already exists');
    }
    
    // Step 8: Remove unique_id column
    console.log('\n🗑️  Step 8: Removing unique_id column...');
    await connection.execute("ALTER TABLE orders DROP COLUMN unique_id");
    console.log('- Dropped unique_id column from orders table');
    
    // Step 9: Commit transaction
    console.log('\n✅ Step 9: Committing changes...');
    await connection.commit();
    console.log('✅ Migration completed successfully!');
    
    // Step 10: Verify migration
    console.log('\n🔍 Step 10: Verifying migration...');
    const [finalColumns] = await connection.execute("DESCRIBE orders");
    const finalHasIdColumn = finalColumns.some(col => col.Field === 'id');
    const finalHasUniqueIdColumn = finalColumns.some(col => col.Field === 'unique_id');
    
    console.log(`- Has 'id' column: ${finalHasIdColumn}`);
    console.log(`- Has 'unique_id' column: ${finalHasUniqueIdColumn}`);
    
    if (finalHasIdColumn && !finalHasUniqueIdColumn) {
      console.log('🎉 Migration verification successful!');
    } else {
      throw new Error('Migration verification failed!');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    
    if (connection) {
      try {
        await connection.rollback();
        console.log('🔄 Transaction rolled back');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError.message);
      }
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('\n🎉 Migration completed successfully!');
      console.log('📝 Next steps:');
      console.log('1. Update your application code to use "id" instead of "unique_id"');
      console.log('2. Test all order-related functionality');
      console.log('3. Update any external integrations that reference unique_id');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };
