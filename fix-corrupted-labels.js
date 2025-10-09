/**
 * Fix corrupted label_downloaded flags
 * 
 * This script resets label_downloaded = 0 for orders that have the flag set to 1
 * but don't have a valid label URL in the labels table.
 */

const db = require('./config/database');

(async () => {
  try {
    console.log('🔧 Starting corrupted labels cleanup...\n');
    
    await db.waitForMySQLInitialization();
    
    if (!db.isMySQLAvailable()) {
      console.error('❌ Database not available');
      process.exit(1);
    }
    
    // Get all orders with label_downloaded = 1
    const [ordersWithFlag] = await db.pool.query(
      'SELECT DISTINCT order_id FROM orders WHERE label_downloaded = 1'
    );
    
    console.log(`Found ${ordersWithFlag.length} unique orders marked as downloaded\n`);
    
    let fixedCount = 0;
    let validCount = 0;
    
    for (const row of ordersWithFlag) {
      const orderId = row.order_id;
      
      // Check if this order has a valid label in labels table
      const label = await db.getLabelByOrderId(orderId);
      
      if (!label || !label.label_url || label.label_url === 'undefined' || label.label_url === 'null') {
        console.log(`❌ ${orderId}: No valid label URL found, resetting flag...`);
        
        // Reset label_downloaded to 0 for this order
        await db.pool.query(
          'UPDATE orders SET label_downloaded = 0 WHERE order_id = ?',
          [orderId]
        );
        
        console.log(`   ✅ Reset label_downloaded = 0 for ${orderId}\n`);
        fixedCount++;
      } else {
        console.log(`✅ ${orderId}: Valid label URL exists`);
        validCount++;
      }
    }
    
    console.log('\n🎉 Cleanup complete!');
    console.log(`  - Valid labels: ${validCount}`);
    console.log(`  - Fixed (reset): ${fixedCount}`);
    console.log(`  - Total processed: ${ordersWithFlag.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();

