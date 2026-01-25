const { checkForRunningBulkOperations, cancelBulkOperation } = require('../services/shopifyProductFetcher');

// Configuration - Update these values
const SHOPIFY_GRAPHQL_URL = 'https://your-shop.myshopify.com/admin/api/2023-10/graphql.json';
const HEADERS = {
  'X-Shopify-Access-Token': 'your-access-token-here',
  'Content-Type': 'application/json'
};

async function resolveBulkOperationConflict() {
  try {
    console.log('🔍 Checking for running bulk operations...');
    
    const runningOperation = await checkForRunningBulkOperations(SHOPIFY_GRAPHQL_URL, HEADERS);
    
    if (runningOperation) {
      console.log(`⚠️  Found running bulk operation: ${runningOperation.id}`);
      console.log(`Status: ${runningOperation.status}`);
      console.log(`Object Count: ${runningOperation.objectCount || 'N/A'}`);
      console.log(`File Size: ${runningOperation.fileSize || 'N/A'} bytes`);
      
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.question('Do you want to cancel this operation? (y/n): ', async (answer) => {
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          try {
            console.log('🔄 Canceling bulk operation...');
            await cancelBulkOperation(SHOPIFY_GRAPHQL_URL, HEADERS, runningOperation.id);
            console.log('✅ Bulk operation canceled successfully');
            console.log('💡 You can now run your product fetch again');
          } catch (error) {
            console.error('❌ Failed to cancel bulk operation:', error.message);
          }
        } else {
          console.log('ℹ️  Operation not canceled. You may need to wait for it to complete.');
        }
        rl.close();
      });
    } else {
      console.log('✅ No running bulk operations found');
      console.log('💡 You can now run your product fetch');
    }
    
  } catch (error) {
    console.error('❌ Error checking bulk operations:', error.message);
  }
}

// Run the script
if (require.main === module) {
  resolveBulkOperationConflict();
}

module.exports = { resolveBulkOperationConflict };
