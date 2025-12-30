/**
 * Script to fix corrupted collectable_amount values in the database
 * 
 * This script recalculates collectable_amount for all orders based on the correct logic:
 * - Prepaid (P): collectable_amount = 0
 * - COD + Partial Paid: collectable_amount = order_total_split - prepaid_amount
 * - COD + NOT Partial Paid: collectable_amount = order_total_split
 * 
 * The bug was caused by using collectable_amount (90% value) instead of order_total_split (100% value)
 * when pushing orders to Shipway, causing a cascading 90% reduction with each clone/reclaim.
 * 
 * This script runs on server startup and is idempotent (safe to run multiple times).
 */

const database = require('../config/database');

/**
 * Calculate the correct collectable_amount for an order
 */
function calculateCorrectCollectableAmount(order) {
  const orderTotalSplit = parseFloat(order.order_total_split) || 0;
  const prepaidAmount = parseFloat(order.prepaid_amount) || 0;
  const paymentType = order.payment_type || 'P';
  const isPartialPaid = order.is_partial_paid === 1 || order.is_partial_paid === true || order.is_partial_paid === '1';
  
  let correctCollectableAmount = 0;
  
  if (paymentType === 'P') {
    // Fully prepaid: nothing to collect
    correctCollectableAmount = 0;
  } else if (paymentType === 'C' && isPartialPaid) {
    // Partial prepaid COD: collect (order_total_split - prepaid_amount)
    correctCollectableAmount = parseFloat((orderTotalSplit - prepaidAmount).toFixed(2));
  } else if (paymentType === 'C' && !isPartialPaid) {
    // Pure COD: collect full amount
    correctCollectableAmount = parseFloat(orderTotalSplit.toFixed(2));
  }
  
  // Ensure non-negative
  if (correctCollectableAmount < 0) {
    correctCollectableAmount = 0;
  }
  
  return correctCollectableAmount;
}

/**
 * Main function to fix all collectable_amount values
 */
async function fixCollectableAmounts() {
  console.log('\n' + '='.repeat(80));
  console.log('🔧 COLLECTABLE AMOUNT CORRECTION SCRIPT');
  console.log('='.repeat(80));
  console.log('Starting at:', new Date().toISOString());
  console.log('');
  
  try {
    // Wait for MySQL initialization
    console.log('⏳ Waiting for MySQL connection...');
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.error('❌ MySQL connection not available. Skipping correction script.');
      return { success: false, message: 'Database not available' };
    }
    
    console.log('✅ MySQL connected\n');
    
    // Get all orders from database
    console.log('📂 Loading all orders from database...');
    const allOrders = await database.getAllOrders();
    console.log(`✅ Loaded ${allOrders.length} orders\n`);
    
    if (allOrders.length === 0) {
      console.log('ℹ️  No orders found in database. Nothing to correct.');
      console.log('='.repeat(80) + '\n');
      return { success: true, message: 'No orders to correct', correctedCount: 0, totalCount: 0 };
    }
    
    // Process each order
    let correctedCount = 0;
    let errorCount = 0;
    const corrections = [];
    
    console.log('🔍 Analyzing orders and correcting collectable_amount...\n');
    
    for (const order of allOrders) {
      try {
        const currentCollectableAmount = parseFloat(order.collectable_amount) || 0;
        const correctCollectableAmount = calculateCorrectCollectableAmount(order);
        
        // Check if correction is needed (allow 0.01 tolerance for floating point)
        const difference = Math.abs(currentCollectableAmount - correctCollectableAmount);
        
        if (difference > 0.01) {
          // Update the order with correct collectable_amount
          await database.updateOrder(order.unique_id, {
            collectable_amount: correctCollectableAmount
          });
          
          correctedCount++;
          
          // Log the correction
          const correctionInfo = {
            order_id: order.order_id,
            product_code: order.product_code,
            payment_type: order.payment_type,
            is_partial_paid: order.is_partial_paid,
            order_total_split: order.order_total_split,
            prepaid_amount: order.prepaid_amount,
            old_collectable: currentCollectableAmount.toFixed(2),
            new_collectable: correctCollectableAmount.toFixed(2),
            difference: difference.toFixed(2)
          };
          
          corrections.push(correctionInfo);
          
          // Log every 10 corrections
          if (correctedCount % 10 === 0) {
            console.log(`   ✓ Corrected ${correctedCount} orders...`);
          }
        }
      } catch (error) {
        errorCount++;
        console.error(`   ✗ Error processing order ${order.order_id} (${order.product_code}):`, error.message);
      }
    }
    
    // Summary
    console.log('\n' + '─'.repeat(80));
    console.log('📊 CORRECTION SUMMARY');
    console.log('─'.repeat(80));
    console.log(`Total orders processed:  ${allOrders.length}`);
    console.log(`Orders corrected:        ${correctedCount}`);
    console.log(`Orders unchanged:        ${allOrders.length - correctedCount - errorCount}`);
    console.log(`Errors:                  ${errorCount}`);
    console.log('');
    
    // Show top 10 corrections (largest differences)
    if (corrections.length > 0) {
      console.log('🔝 TOP 10 CORRECTIONS (by difference):');
      console.log('─'.repeat(80));
      
      const topCorrections = corrections
        .sort((a, b) => parseFloat(b.difference) - parseFloat(a.difference))
        .slice(0, 10);
      
      topCorrections.forEach((correction, index) => {
        console.log(`${index + 1}. Order: ${correction.order_id} | Product: ${correction.product_code}`);
        console.log(`   Payment: ${correction.payment_type} | Partial Paid: ${correction.is_partial_paid}`);
        console.log(`   Order Total Split: ₹${correction.order_total_split} | Prepaid: ₹${correction.prepaid_amount}`);
        console.log(`   OLD: ₹${correction.old_collectable} → NEW: ₹${correction.new_collectable} (diff: ₹${correction.difference})`);
        console.log('');
      });
    }
    
    console.log('='.repeat(80));
    console.log('✅ CORRECTION SCRIPT COMPLETED SUCCESSFULLY');
    console.log('Finished at:', new Date().toISOString());
    console.log('='.repeat(80) + '\n');
    
    return {
      success: true,
      message: 'Correction completed',
      correctedCount,
      totalCount: allOrders.length,
      errorCount,
      corrections: corrections.slice(0, 10) // Return top 10 for logging
    };
    
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ CORRECTION SCRIPT FAILED');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(80) + '\n');
    
    return {
      success: false,
      message: error.message,
      correctedCount: 0,
      totalCount: 0
    };
  }
}

// Export for use in server startup
module.exports = { fixCollectableAmounts };

// Allow running standalone
if (require.main === module) {
  fixCollectableAmounts()
    .then((result) => {
      if (result.success) {
        console.log('✅ Script completed successfully');
        process.exit(0);
      } else {
        console.error('❌ Script failed:', result.message);
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Unexpected error:', error);
      process.exit(1);
    });
}

