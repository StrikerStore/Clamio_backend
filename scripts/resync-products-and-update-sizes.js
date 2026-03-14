/**
 * Script to:
 * 1. Re-sync products from Shopify for all active stores (to update sku_id with decimal size handling)
 * 2. Update all existing orders with extracted sizes (including decimal sizes like 5.5, 6.5)
 */

// Load environment variables
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const database = require('../config/database');
// ShopifyProductFetcher is exported as the default export
const ShopifyProductFetcher = require('../services/shopifyProductFetcher');

async function resyncProductsAndUpdateSizes() {
  console.log('\n🚀 Starting Product Re-sync and Size Update Process...\n');

  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();

    if (!database.isMySQLAvailable()) {
      throw new Error('MySQL connection not available');
    }

    // Step 1: Re-sync products from Shopify for all active stores
    console.log('📦 Step 1: Re-syncing products from Shopify...\n');
    
    const stores = await database.getAllStores();
    const activeStores = stores.filter(store => store.status === 'active');
    
    console.log(`Found ${activeStores.length} active stores\n`);

    let totalProductsSynced = 0;
    let storesWithProducts = 0;

    for (const store of activeStores) {
      if (store.shopify_token && store.shopify_store_url) {
        try {
          console.log(`🛍️  Syncing products for store: ${store.store_name} (${store.account_code})...`);
          
          const productFetcher = new ShopifyProductFetcher(store.account_code);
          const result = await productFetcher.syncProducts();
          
          if (result.success) {
            console.log(`   ✅ Synced ${result.productCount} products\n`);
            totalProductsSynced += result.productCount || 0;
            storesWithProducts++;
          } else {
            console.log(`   ⚠️  Sync completed with warnings: ${result.message}\n`);
          }
        } catch (error) {
          console.error(`   ❌ Failed to sync products for ${store.store_name}: ${error.message}\n`);
        }
      } else {
        console.log(`   ⏭️  Skipping ${store.store_name} - Shopify credentials not configured\n`);
      }
    }

    console.log(`\n✅ Product sync completed:`);
    console.log(`   - Stores processed: ${storesWithProducts}`);
    console.log(`   - Total products synced: ${totalProductsSynced}\n`);

    // Step 2: Update all existing orders with sizes (including those with NULL size)
    console.log('📏 Step 2: Updating sizes for all existing orders...\n');

    // Get all orders that need size update (NULL size or empty size)
    const [orders] = await database.mysqlConnection.execute(
      `SELECT unique_id, product_code, size FROM orders WHERE (size IS NULL OR size = '') AND product_code IS NOT NULL AND product_code != ''`
    );

    console.log(`Found ${orders.length} orders that need size update\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const order of orders) {
      try {
        const extractedSize = database.extractSizeFromSku(order.product_code);
        if (extractedSize) {
          await database.mysqlConnection.execute(
            `UPDATE orders SET size = ? WHERE unique_id = ?`,
            [extractedSize, order.unique_id]
          );
          updatedCount++;
          
          // Log first 10 updates for verification
          if (updatedCount <= 10) {
            console.log(`   ✅ Updated: ${order.product_code} → size: ${extractedSize}`);
          }
        } else {
          skippedCount++;
          // Log first 5 skipped for debugging
          if (skippedCount <= 5) {
            console.log(`   ⏭️  Skipped: ${order.product_code} (no size found)`);
          }
        }
      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error updating order ${order.unique_id}: ${error.message}`);
      }
    }

    // Also update orders that might have incorrect sizes (re-extract to catch decimal sizes)
    console.log('\n🔄 Step 3: Re-extracting sizes for orders with existing sizes (to catch decimal sizes)...\n');
    
    const [ordersWithSize] = await database.mysqlConnection.execute(
      `SELECT unique_id, product_code, size FROM orders WHERE size IS NOT NULL AND size != '' AND product_code IS NOT NULL AND product_code != ''`
    );

    console.log(`Found ${ordersWithSize.length} orders with existing sizes to re-check\n`);

    let reExtractedCount = 0;

    for (const order of ordersWithSize) {
      try {
        const extractedSize = database.extractSizeFromSku(order.product_code);
        if (extractedSize && extractedSize !== order.size) {
          await database.mysqlConnection.execute(
            `UPDATE orders SET size = ? WHERE unique_id = ?`,
            [extractedSize, order.unique_id]
          );
          reExtractedCount++;
          
          // Log first 10 re-extractions for verification
          if (reExtractedCount <= 10) {
            console.log(`   ✅ Re-extracted: ${order.product_code} → ${order.size} → ${extractedSize}`);
          }
        }
      } catch (error) {
        console.error(`   ❌ Error re-extracting size for order ${order.unique_id}: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(60));
    console.log(`✅ Products synced: ${totalProductsSynced} products from ${storesWithProducts} stores`);
    console.log(`✅ Orders updated (NULL → size): ${updatedCount}`);
    console.log(`✅ Orders re-extracted (size updated): ${reExtractedCount}`);
    console.log(`⏭️  Orders skipped (no size found): ${skippedCount}`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount}`);
    }
    console.log('='.repeat(60));
    console.log('\n✅ Process completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Error during process:', error);
    throw error;
  }
}

// Run the script
if (require.main === module) {
  resyncProductsAndUpdateSizes()
    .then(() => {
      console.log('✅ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { resyncProductsAndUpdateSizes };
