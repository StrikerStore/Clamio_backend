#!/usr/bin/env node

/**
 * Script to debug the full getAllOrders query with all JOINs
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

async function fullDebugQuery() {
  console.log('🔍 Debugging the full getAllOrders query...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }
    
    console.log('✅ MySQL connection established');
    
    const targetUniqueId = '936598AF44D3';
    
    // Test the exact query from getAllOrders method
    console.log('\n🔍 Testing the exact getAllOrders query:');
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
      WHERE o.unique_id = ? AND (o.is_in_new_order = 1 OR c.label_downloaded = 1)
      ORDER BY o.order_date DESC, o.order_id, o.product_name
    `, [targetUniqueId]);
    
    console.log(`📊 Rows returned for unique_id "${targetUniqueId}": ${rows.length}`);
    
    rows.forEach((row, index) => {
      console.log(`\nRow ${index + 1}:`);
      console.log(`  id: ${row.id}`);
      console.log(`  unique_id: ${row.unique_id}`);
      console.log(`  order_id: ${row.order_id}`);
      console.log(`  product_code: ${row.product_code}`);
      console.log(`  is_in_new_order: ${row.is_in_new_order}`);
      console.log(`  product_image: ${row.product_image}`);
      console.log(`  claims_status: ${row.claims_status}`);
      console.log(`  claimed_by: ${row.claimed_by}`);
      console.log(`  label_downloaded: ${row.label_downloaded}`);
      console.log(`  label_url: ${row.label_url}`);
      console.log(`  awb: ${row.awb}`);
      console.log(`  carrier_id: ${row.carrier_id}`);
      console.log(`  carrier_name: ${row.carrier_name}`);
      console.log(`  status: ${row.status}`);
    });
    
    // Now let's test each JOIN separately to see which one is causing duplicates
    console.log('\n🔍 Testing JOINs separately:');
    
    // Test orders + products JOIN
    const [ordersProductsRows] = await database.mysqlConnection.execute(`
      SELECT o.*, p.image as product_image
      FROM orders o
      LEFT JOIN products p ON (
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id
      )
      WHERE o.unique_id = ?
    `, [targetUniqueId]);
    
    console.log(`Orders + Products JOIN: ${ordersProductsRows.length} rows`);
    
    // Test orders + products + claims JOIN
    const [ordersProductsClaimsRows] = await database.mysqlConnection.execute(`
      SELECT o.*, p.image as product_image, c.status as claims_status, c.claimed_by, c.label_downloaded
      FROM orders o
      LEFT JOIN products p ON (
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id
      )
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id
      WHERE o.unique_id = ?
    `, [targetUniqueId]);
    
    console.log(`Orders + Products + Claims JOIN: ${ordersProductsClaimsRows.length} rows`);
    
    // Test orders + products + claims + labels JOIN
    const [ordersProductsClaimsLabelsRows] = await database.mysqlConnection.execute(`
      SELECT o.*, p.image as product_image, c.status as claims_status, c.claimed_by, c.label_downloaded, l.label_url, l.awb
      FROM orders o
      LEFT JOIN products p ON (
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id
      )
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id
      LEFT JOIN labels l ON o.order_id = l.order_id
      WHERE o.unique_id = ?
    `, [targetUniqueId]);
    
    console.log(`Orders + Products + Claims + Labels JOIN: ${ordersProductsClaimsLabelsRows.length} rows`);
    
    // Test with WHERE clause
    const [withWhereClauseRows] = await database.mysqlConnection.execute(`
      SELECT o.*, p.image as product_image, c.status as claims_status, c.claimed_by, c.label_downloaded, l.label_url, l.awb
      FROM orders o
      LEFT JOIN products p ON (
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id
      )
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id
      LEFT JOIN labels l ON o.order_id = l.order_id
      WHERE o.unique_id = ? AND (o.is_in_new_order = 1 OR c.label_downloaded = 1)
    `, [targetUniqueId]);
    
    console.log(`With WHERE clause: ${withWhereClauseRows.length} rows`);
    
  } catch (error) {
    console.error('❌ Error debugging query:', error);
    throw error;
  }
}

// Run the script if called directly
if (require.main === module) {
  fullDebugQuery()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fullDebugQuery };
