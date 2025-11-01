#!/usr/bin/env node

/**
 * Script to check for duplicate unique_id values in the orders table
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

async function checkDuplicateUniqueIds() {
  console.log('🔍 Checking for duplicate unique_id values...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }
    
    console.log('✅ MySQL connection established');
    
    // Find duplicate unique_id values
    console.log('🔍 Finding duplicate unique_id values...');
    
    const [duplicates] = await database.mysqlConnection.execute(`
      SELECT unique_id, COUNT(*) as count 
      FROM orders 
      WHERE unique_id IS NOT NULL 
      GROUP BY unique_id 
      HAVING COUNT(*) > 1
    `);
    
    console.log(`📊 Found ${duplicates.length} duplicate unique_id values`);
    
    if (duplicates.length === 0) {
      console.log('✅ No duplicate unique_id values found. Database is clean!');
      return;
    }
    
    // Show details for each duplicate
    for (const duplicate of duplicates) {
      const duplicateUniqueId = duplicate.unique_id;
      console.log(`\n🔧 Duplicate unique_id: ${duplicateUniqueId} (appears ${duplicate.count} times)`);
      
      // Get all orders with this duplicate unique_id
      const [ordersWithDuplicate] = await database.mysqlConnection.execute(`
        SELECT id, unique_id, order_id, product_code, customer_name, status 
        FROM orders WHERE unique_id = ? ORDER BY id
      `, [duplicateUniqueId]);
      
      ordersWithDuplicate.forEach((order, index) => {
        console.log(`  Row ${index + 1}:`);
        console.log(`    id: ${order.id}`);
        console.log(`    order_id: ${order.order_id}`);
        console.log(`    product_code: ${order.product_code}`);
        console.log(`    customer_name: ${order.customer_name}`);
        console.log(`    status: ${order.status}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error checking duplicate unique_id values:', error);
    throw error;
  }
}

// Run the script if called directly
if (require.main === module) {
  checkDuplicateUniqueIds()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { checkDuplicateUniqueIds };
