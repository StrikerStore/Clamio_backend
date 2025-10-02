const database = require('./config/database');

console.log('🔍 Checking image data in MySQL database...\n');

async function checkImageData() {
  try {
    // Wait for MySQL initialization
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return;
    }
    
    // Check orders data (with product images from JOIN)
    const ordersData = await database.getAllOrders();
    
    console.log('📦 ORDERS DATA:');
    console.log(`  Total orders: ${ordersData.length}`);
    console.log(`  Orders with product_image: ${ordersData.filter(o => o.product_image && o.product_image !== '/placeholder.svg').length}`);
    console.log(`  Orders without product_image: ${ordersData.filter(o => !o.product_image || o.product_image === '/placeholder.svg').length}`);
    
    // Show sample orders
    console.log('\n  Sample orders:');
    ordersData.slice(0, 5).forEach((order, i) => {
      console.log(`    ${i+1}. ${order.product_name} -> Image: ${order.product_image || 'MISSING'}`);
    });
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Check products data
    const productsData = await database.getAllProducts();
    
    console.log('🖼️  PRODUCTS DATA:');
    console.log(`  Total products: ${productsData.length}`);
    console.log(`  Products with images: ${productsData.filter(p => p.image && p.image !== '/placeholder.svg').length}`);
    console.log(`  Products without images: ${productsData.filter(p => !p.image || p.image === '/placeholder.svg').length}`);
    
    // Show sample products
    console.log('\n  Sample products with images:');
    productsData.filter(p => p.image && p.image !== '/placeholder.svg').slice(0, 5).forEach((product, i) => {
      console.log(`    ${i+1}. ${product.name} -> ${product.image}`);
    });
    
    console.log('\n  Sample products without images:');
    productsData.filter(p => !p.image || p.image === '/placeholder.svg').slice(0, 5).forEach((product, i) => {
      console.log(`    ${i+1}. ${product.name} -> ${product.image || 'MISSING'}`);
    });
    
    console.log('\n💡 Product images are now fetched directly from products table via JOIN');
    console.log('💡 No need to store product_image in orders table anymore');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the check
checkImageData();
