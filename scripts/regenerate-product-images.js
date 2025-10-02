const database = require('../config/database');

console.log('🖼️  Product images are now fetched directly from products table via JOIN...\n');

async function checkProductImages() {
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return;
    }
    
    // Get sample orders with product images
    const orders = await database.getAllOrders();
    console.log(`📦 Found ${orders.length} orders in database`);
    
    // Count results
    const withImages = orders.filter(o => o.product_image && o.product_image !== '/placeholder.svg').length;
    const withoutImages = orders.filter(o => !o.product_image || o.product_image === '/placeholder.svg').length;
    
    console.log(`\n📊 Results:`);
    console.log(`  ✅ Orders with images: ${withImages}`);
    console.log(`  ⚠️  Orders without images: ${withoutImages}`);
    console.log(`  📈 Success rate: ${orders.length > 0 ? ((withImages / orders.length) * 100).toFixed(1) : 0}%`);
    
    // Show some examples
    if (withImages > 0) {
      console.log(`\n🔍 Sample orders with images:`);
      orders.filter(o => o.product_image && o.product_image !== '/placeholder.svg').slice(0, 5).forEach((order, i) => {
        console.log(`  ${i+1}. ${order.product_name} -> ${order.product_image}`);
      });
    }
    
    if (withoutImages > 0) {
      console.log(`\n⚠️  Sample orders without images:`);
      orders.filter(o => !o.product_image || o.product_image === '/placeholder.svg').slice(0, 5).forEach((order, i) => {
        console.log(`  ${i+1}. ${order.product_name} -> ${order.product_image || 'MISSING'}`);
      });
    }
    
    console.log(`\n💡 Product images are now fetched directly from products table via JOIN`);
    console.log(`💡 No manual regeneration needed - images are fetched in real-time`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the script
if (require.main === module) {
  checkProductImages();
}

module.exports = { checkProductImages };
