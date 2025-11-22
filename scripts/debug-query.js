#!/usr/bin/env node

/**
 * Script to debug the WHERE clause condition
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

async function debugQuery() {
  console.log('🔍 Debugging the WHERE clause condition...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }
    
    console.log('✅ MySQL connection established');
    
    const targetUniqueId = '936598AF44D3';
    
    // First, let's check the base order data
    console.log('\n📋 Base order data:');
    const [orderRows] = await database.mysqlConnection.execute(`
      SELECT * FROM orders WHERE unique_id = ?
    `, [targetUniqueId]);
    
    orderRows.forEach((row, index) => {
      console.log(`Order ${index + 1}:`);
      console.log(`  id: ${row.id}`);
      console.log(`  unique_id: ${row.unique_id}`);
      console.log(`  order_id: ${row.order_id}`);
      console.log(`  is_in_new_order: ${row.is_in_new_order}`);
      console.log(`  product_code: ${row.product_code}`);
    });
    
    // Check claims data
    console.log('\n📋 Claims data:');
    const [claimRows] = await database.mysqlConnection.execute(`
      SELECT * FROM claims WHERE order_unique_id = ?
    `, [targetUniqueId]);
    
    claimRows.forEach((row, index) => {
      console.log(`Claim ${index + 1}:`);
      console.log(`  order_unique_id: ${row.order_unique_id}`);
      console.log(`  label_downloaded: ${row.label_downloaded}`);
      console.log(`  status: ${row.status}`);
    });
    
    // Check labels data
    const orderId = orderRows[0]?.order_id;
    if (orderId) {
      console.log('\n📋 Labels data:');
      const [labelRows] = await database.mysqlConnection.execute(`
        SELECT * FROM labels WHERE order_id = ?
      `, [orderId]);
      
      labelRows.forEach((row, index) => {
        console.log(`Label ${index + 1}:`);
        console.log(`  order_id: ${row.order_id}`);
        console.log(`  label_url: ${row.label_url}`);
        console.log(`  awb: ${row.awb}`);
      });
    }
    
    // Now let's test the WHERE clause condition step by step
    console.log('\n🔍 Testing WHERE clause conditions:');
    
    // Test condition 1: is_in_new_order = 1
    const [condition1Rows] = await database.mysqlConnection.execute(`
      SELECT o.*, c.label_downloaded
      FROM orders o
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id
      WHERE o.unique_id = ? AND o.is_in_new_order = 1
    `, [targetUniqueId]);
    
    console.log(`Condition 1 (is_in_new_order = 1): ${condition1Rows.length} rows`);
    condition1Rows.forEach((row, index) => {
      console.log(`  Row ${index + 1}: is_in_new_order=${row.is_in_new_order}, label_downloaded=${row.label_downloaded}`);
    });
    
    // Test condition 2: label_downloaded = 1
    const [condition2Rows] = await database.mysqlConnection.execute(`
      SELECT o.*, c.label_downloaded
      FROM orders o
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id
      WHERE o.unique_id = ? AND c.label_downloaded = 1
    `, [targetUniqueId]);
    
    console.log(`Condition 2 (label_downloaded = 1): ${condition2Rows.length} rows`);
    condition2Rows.forEach((row, index) => {
      console.log(`  Row ${index + 1}: is_in_new_order=${row.is_in_new_order}, label_downloaded=${row.label_downloaded}`);
    });
    
    // Test the combined condition
    const [combinedRows] = await database.mysqlConnection.execute(`
      SELECT o.*, c.label_downloaded
      FROM orders o
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id
      WHERE o.unique_id = ? AND (o.is_in_new_order = 1 OR c.label_downloaded = 1)
    `, [targetUniqueId]);
    
    console.log(`Combined condition (is_in_new_order = 1 OR label_downloaded = 1): ${combinedRows.length} rows`);
    combinedRows.forEach((row, index) => {
      console.log(`  Row ${index + 1}: is_in_new_order=${row.is_in_new_order}, label_downloaded=${row.label_downloaded}`);
    });
    
    // Test with DISTINCT
    const [distinctRows] = await database.mysqlConnection.execute(`
      SELECT DISTINCT o.*, c.label_downloaded
      FROM orders o
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id
      WHERE o.unique_id = ? AND (o.is_in_new_order = 1 OR c.label_downloaded = 1)
    `, [targetUniqueId]);
    
    console.log(`With DISTINCT: ${distinctRows.length} rows`);
    distinctRows.forEach((row, index) => {
      console.log(`  Row ${index + 1}: is_in_new_order=${row.is_in_new_order}, label_downloaded=${row.label_downloaded}`);
    });
    
  } catch (error) {
    console.error('❌ Error debugging query:', error);
    throw error;
  }
}

// Run the script if called directly
if (require.main === module) {
  debugQuery()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { debugQuery };
