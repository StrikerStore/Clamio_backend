#!/usr/bin/env node

/**
 * Script to test the getAllOrders query for duplicate rows
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

async function testQuery() {
  console.log('🔍 Testing getAllOrders query for duplicates...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }
    
    console.log('✅ MySQL connection established');
    
    // Test the exact query from getAllOrders method
    const [rows] = await database.mysqlConnection.execute(`
      SELECT 
        o.*,
        p.image as product_image,
        c.status as claims_status,
        c.claimed_by,
        c.claimed_at,
        c.last_claimed_by,
        c.last_claimed_at,
        c.clone_status,
        c.cloned_order_id,
        c.is_cloned_row,
        c.label_downloaded,
        l.label_url,
        l.awb,
        l.carrier_id,
        l.carrier_name,
        l.handover_at,
        c.priority_carrier,
        l.is_manifest,
        l.current_shipment_status,
        l.is_handover,
        CASE 
          WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
          THEN l.current_shipment_status 
          ELSE c.status 
        END as status
      FROM orders o
      LEFT JOIN products p ON (
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id
      )
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id
      LEFT JOIN labels l ON o.order_id = l.order_id
      WHERE (o.is_in_new_order = 1 OR c.label_downloaded = 1) 
      ORDER BY o.order_date DESC, o.order_id, o.product_name
    `);
    
    console.log(`📊 Total rows returned: ${rows.length}`);
    
    // Check for the specific unique_id that's causing the error
    const targetUniqueId = '936598AF44D3';
    const matchingRows = rows.filter(row => row.unique_id === targetUniqueId);
    
    console.log(`\n🔍 Rows with unique_id "${targetUniqueId}": ${matchingRows.length}`);
    
    if (matchingRows.length > 0) {
      console.log('\n📋 Details of matching rows:');
      matchingRows.forEach((row, index) => {
        console.log(`\nRow ${index + 1}:`);
        console.log(`  id: ${row.id}`);
        console.log(`  unique_id: ${row.unique_id}`);
        console.log(`  order_id: ${row.order_id}`);
        console.log(`  product_code: ${row.product_code}`);
        console.log(`  customer_name: ${row.customer_name}`);
        console.log(`  claimed_by: ${row.claimed_by}`);
        console.log(`  label_url: ${row.label_url}`);
        console.log(`  awb: ${row.awb}`);
        console.log(`  carrier_id: ${row.carrier_id}`);
        console.log(`  carrier_name: ${row.carrier_name}`);
        console.log(`  status: ${row.status}`);
      });
      
      // Check if there are multiple claims for this unique_id
      const [claimsRows] = await database.mysqlConnection.execute(`
        SELECT * FROM claims WHERE order_unique_id = ?
      `, [targetUniqueId]);
      
      console.log(`\n🔍 Claims for unique_id "${targetUniqueId}": ${claimsRows.length}`);
      claimsRows.forEach((claim, index) => {
        console.log(`  Claim ${index + 1}:`);
        console.log(`    order_unique_id: ${claim.order_unique_id}`);
        console.log(`    claimed_by: ${claim.claimed_by}`);
        console.log(`    status: ${claim.status}`);
        console.log(`    claimed_at: ${claim.claimed_at}`);
      });
      
      // Check if there are multiple labels for this order_id
      const orderId = matchingRows[0].order_id;
      const [labelsRows] = await database.mysqlConnection.execute(`
        SELECT * FROM labels WHERE order_id = ?
      `, [orderId]);
      
      console.log(`\n🔍 Labels for order_id "${orderId}": ${labelsRows.length}`);
      labelsRows.forEach((label, index) => {
        console.log(`  Label ${index + 1}:`);
        console.log(`    order_id: ${label.order_id}`);
        console.log(`    label_url: ${label.label_url}`);
        console.log(`    awb: ${label.awb}`);
        console.log(`    carrier_id: ${label.carrier_id}`);
        console.log(`    carrier_name: ${label.carrier_name}`);
      });
    }
    
    // Check for any unique_id with multiple rows
    const uniqueIdCounts = {};
    rows.forEach(row => {
      if (row.unique_id) {
        uniqueIdCounts[row.unique_id] = (uniqueIdCounts[row.unique_id] || 0) + 1;
      }
    });
    
    const duplicates = Object.entries(uniqueIdCounts).filter(([uniqueId, count]) => count > 1);
    
    console.log(`\n📊 Unique IDs with multiple rows: ${duplicates.length}`);
    duplicates.forEach(([uniqueId, count]) => {
      console.log(`  ${uniqueId}: ${count} rows`);
    });
    
  } catch (error) {
    console.error('❌ Error testing query:', error);
    throw error;
  }
}

// Run the script if called directly
if (require.main === module) {
  testQuery()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { testQuery };
