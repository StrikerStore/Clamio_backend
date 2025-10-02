#!/usr/bin/env node

/**
 * Script to fix duplicate unique_id values in the orders table
 * This script will:
 * 1. Find duplicate unique_id values
 * 2. Assign new auto-incremented unique_id values to duplicates
 * 3. Update related tables (claims, labels) accordingly
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

async function fixDuplicateUniqueIds() {
  console.log('🔧 Starting unique_id duplicate fix...');
  
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }
    
    console.log('✅ MySQL connection established');
    
    // Step 1: Find duplicate unique_id values
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
    
    // Step 2: Get the current maximum unique_id
    const [maxResult] = await database.mysqlConnection.execute(`
      SELECT MAX(CAST(unique_id AS UNSIGNED)) as max_id FROM orders WHERE unique_id REGEXP '^[0-9]+$'
    `);
    
    let nextUniqueId = (maxResult[0]?.max_id || 0) + 1;
    console.log(`🔢 Next available unique_id: ${nextUniqueId}`);
    
    // Step 3: Fix each duplicate group
    for (const duplicate of duplicates) {
      const duplicateUniqueId = duplicate.unique_id;
      console.log(`🔧 Fixing duplicate unique_id: ${duplicateUniqueId}`);
      
      // Get all orders with this duplicate unique_id
      const [ordersWithDuplicate] = await database.mysqlConnection.execute(`
        SELECT * FROM orders WHERE unique_id = ? ORDER BY id
      `, [duplicateUniqueId]);
      
      // Keep the first order with the original unique_id, assign new ones to the rest
      for (let i = 1; i < ordersWithDuplicate.length; i++) {
        const order = ordersWithDuplicate[i];
        const newUniqueId = nextUniqueId++;
        
        console.log(`  📝 Updating order ${order.id} to new unique_id: ${newUniqueId}`);
        
        // Update the order's unique_id
        await database.mysqlConnection.execute(`
          UPDATE orders SET unique_id = ? WHERE id = ?
        `, [newUniqueId, order.id]);
        
        // Update claims table if it exists
        await database.mysqlConnection.execute(`
          UPDATE claims SET order_unique_id = ? WHERE order_unique_id = ? AND order_id = ?
        `, [newUniqueId, duplicateUniqueId, order.order_id]);
        
        console.log(`  ✅ Updated order ${order.id} and related claims`);
      }
    }
    
    console.log('🎉 Successfully fixed all duplicate unique_id values!');
    
    // Step 4: Verify the fix
    console.log('🔍 Verifying fix...');
    
    const [remainingDuplicates] = await database.mysqlConnection.execute(`
      SELECT unique_id, COUNT(*) as count 
      FROM orders 
      WHERE unique_id IS NOT NULL 
      GROUP BY unique_id 
      HAVING COUNT(*) > 1
    `);
    
    if (remainingDuplicates.length === 0) {
      console.log('✅ Verification successful! No more duplicate unique_id values.');
    } else {
      console.log(`❌ Verification failed! Still found ${remainingDuplicates.length} duplicate unique_id values.`);
    }
    
  } catch (error) {
    console.error('❌ Error fixing duplicate unique_id values:', error);
    throw error;
  }
}

// Run the script if called directly
if (require.main === module) {
  fixDuplicateUniqueIds()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixDuplicateUniqueIds };

        SELECT * FROM orders WHERE unique_id = ? ORDER BY id

      `, [duplicateUniqueId]);

      

      // Keep the first order with the original unique_id, assign new ones to the rest

      for (let i = 1; i < ordersWithDuplicate.length; i++) {

        const order = ordersWithDuplicate[i];

        const newUniqueId = nextUniqueId++;

        

        console.log(`  📝 Updating order ${order.id} to new unique_id: ${newUniqueId}`);

        

        // Update the order's unique_id

        await database.mysqlConnection.execute(`

          UPDATE orders SET unique_id = ? WHERE id = ?

        `, [newUniqueId, order.id]);

        

        // Update claims table if it exists

        await database.mysqlConnection.execute(`

          UPDATE claims SET order_unique_id = ? WHERE order_unique_id = ? AND order_id = ?

        `, [newUniqueId, duplicateUniqueId, order.order_id]);

        

        console.log(`  ✅ Updated order ${order.id} and related claims`);

      }

    }

    

    console.log('🎉 Successfully fixed all duplicate unique_id values!');

    

    // Step 4: Verify the fix

    console.log('🔍 Verifying fix...');

    

    const [remainingDuplicates] = await database.mysqlConnection.execute(`

      SELECT unique_id, COUNT(*) as count 

      FROM orders 

      WHERE unique_id IS NOT NULL 

      GROUP BY unique_id 

      HAVING COUNT(*) > 1

    `);

    

    if (remainingDuplicates.length === 0) {

      console.log('✅ Verification successful! No more duplicate unique_id values.');

    } else {

      console.log(`❌ Verification failed! Still found ${remainingDuplicates.length} duplicate unique_id values.`);

    }

    

  } catch (error) {

    console.error('❌ Error fixing duplicate unique_id values:', error);

    throw error;

  }

}



// Run the script if called directly

if (require.main === module) {

  fixDuplicateUniqueIds()

    .then(() => {

      console.log('✅ Script completed successfully');

      process.exit(0);

    })

    .catch((error) => {

      console.error('❌ Script failed:', error);

      process.exit(1);

    });

}



module.exports = { fixDuplicateUniqueIds };


