require('dotenv').config();
const carrierServiceabilityService = require('../services/carrierServiceabilityService');

async function assignPriorityCarriers() {
  try {
    console.log('🚀 PRIORITY CARRIER ASSIGNMENT: Starting assignment process...');
    
    // Step 1: Assign priority carriers to all orders
    console.log('\n📡 STEP 1: Assigning priority carriers to orders...');
    const result = await carrierServiceabilityService.assignPriorityCarriersToOrders();
    
    console.log('\n✅ Assignment completed successfully!');
    console.log('📊 Results:');
    console.log(`  - Message: ${result.message}`);
    console.log(`  - File: ${result.filePath}`);
    console.log(`  - Orders processed: ${result.orderCount}`);
    console.log(`  - Summary: ${JSON.stringify(result.summary, null, 2)}`);
    
    // Step 2: Get statistics
    console.log('\n📊 STEP 2: Getting assignment statistics...');
    const stats = carrierServiceabilityService.getAssignmentStatistics();
    
    console.log('\n📈 Statistics:');
    console.log(`  - Orders: ${stats.orders.total} total, ${stats.orders.withCarrier} with carriers (${stats.orders.successRate} success rate)`);
    console.log(`  - Carriers: ${stats.carriers.total} total, ${stats.carriers.used} used`);
    console.log(`  - Pincodes: ${stats.pincodes.total} unique`);
    console.log(`  - Payment Types: ${stats.paymentTypes.total} unique`);
    
    if (Object.keys(stats.carriers.usage).length > 0) {
      console.log('\n🎯 Carrier Usage:');
      Object.entries(stats.carriers.usage)
        .sort(([,a], [,b]) => b - a)
        .forEach(([carrierId, count]) => {
          console.log(`  - ${carrierId}: ${count} orders`);
        });
    }
    
    console.log('\n🎉 PRIORITY CARRIER ASSIGNMENT: All processes completed successfully!');
    
  } catch (error) {
    console.error('\n💥 PRIORITY CARRIER ASSIGNMENT: Process failed:', error.message);
    console.error('  - Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the assignment process
assignPriorityCarriers(); 