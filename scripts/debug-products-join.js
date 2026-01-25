#!/usr/bin/env node

/**
 * Script to debug the Products JOIN that's causing duplicates
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

async function debugProductsJoin() {
  console.log('🔍 Debugging the Products JOIN...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }
    
    console.log('✅ MySQL connection established');
    
    const targetUniqueId = '936598AF44D3';
    
    // Get the order data first
    const [orderRows] = await database.mysqlConnection.execute(`
      SELECT * FROM orders WHERE unique_id = ?
    `, [targetUniqueId]);
    
    if (orderRows.length === 0) {
      console.log('❌ No order found with the target unique_id');
      return;
    }
    
    const order = orderRows[0];
    console.log(`\n📋 Order data:`);
    console.log(`  product_code: ${order.product_code}`);
    
    // Test each REGEXP condition separately
    const productCode = order.product_code;
    
    console.log(`\n🔍 Testing REGEXP conditions for product_code: "${productCode}"`);
    
    // Condition 1: Remove size suffixes
    const condition1 = `REGEXP_REPLACE(TRIM(REGEXP_REPLACE('${productCode}', '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-')`;
    console.log(`\nCondition 1 (remove size suffixes): ${condition1}`);
    
    const [condition1Result] = await database.mysqlConnection.execute(`
      SELECT ${condition1} as result
    `);
    console.log(`  Result: "${condition1Result[0].result}"`);
    
    // Condition 2: Remove number-number suffixes
    const condition2 = `REGEXP_REPLACE(TRIM(REGEXP_REPLACE('${productCode}', '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-')`;
    console.log(`\nCondition 2 (remove number-number suffixes): ${condition2}`);
    
    const [condition2Result] = await database.mysqlConnection.execute(`
      SELECT ${condition2} as result
    `);
    console.log(`  Result: "${condition2Result[0].result}"`);
    
    // Condition 3: Remove single number suffixes
    const condition3 = `REGEXP_REPLACE(TRIM(REGEXP_REPLACE('${productCode}', '[-_][0-9]+$', '')), '[-_]{2,}', '-')`;
    console.log(`\nCondition 3 (remove single number suffixes): ${condition3}`);
    
    const [condition3Result] = await database.mysqlConnection.execute(`
      SELECT ${condition3} as result
    `);
    console.log(`  Result: "${condition3Result[0].result}"`);
    
    // Now check which products match each condition
    console.log(`\n🔍 Products matching each condition:`);
    
    // Check products matching condition 1
    const [products1] = await database.mysqlConnection.execute(`
      SELECT sku_id, image FROM products WHERE sku_id = ${condition1}
    `);
    console.log(`\nProducts matching condition 1: ${products1.length}`);
    products1.forEach((product, index) => {
      console.log(`  Product ${index + 1}: sku_id="${product.sku_id}", image="${product.image}"`);
    });
    
    // Check products matching condition 2
    const [products2] = await database.mysqlConnection.execute(`
      SELECT sku_id, image FROM products WHERE sku_id = ${condition2}
    `);
    console.log(`\nProducts matching condition 2: ${products2.length}`);
    products2.forEach((product, index) => {
      console.log(`  Product ${index + 1}: sku_id="${product.sku_id}", image="${product.image}"`);
    });
    
    // Check products matching condition 3
    const [products3] = await database.mysqlConnection.execute(`
      SELECT sku_id, image FROM products WHERE sku_id = ${condition3}
    `);
    console.log(`\nProducts matching condition 3: ${products3.length}`);
    products3.forEach((product, index) => {
      console.log(`  Product ${index + 1}: sku_id="${product.sku_id}", image="${product.image}"`);
    });
    
    // Test the full OR condition
    console.log(`\n🔍 Testing the full OR condition:`);
    const [allMatchingProducts] = await database.mysqlConnection.execute(`
      SELECT sku_id, image FROM products WHERE 
        sku_id = ${condition1} OR
        sku_id = ${condition2} OR
        sku_id = ${condition3}
    `);
    console.log(`Total products matching any condition: ${allMatchingProducts.length}`);
    allMatchingProducts.forEach((product, index) => {
      console.log(`  Product ${index + 1}: sku_id="${product.sku_id}", image="${product.image}"`);
    });
    
  } catch (error) {
    console.error('❌ Error debugging products JOIN:', error);
    throw error;
  }
}

// Run the script if called directly
if (require.main === module) {
  debugProductsJoin()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { debugProductsJoin };
