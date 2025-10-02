const carrierSyncService = require('./services/carrierSyncService');

async function manualCarrierSync() {
  try {
    console.log('🚀 Manual Carrier Sync Started...\n');
    
    const result = await carrierSyncService.startCarrierSync();
    
    if (result.success) {
      console.log('✅ Carrier sync completed successfully!');
      console.log('  - Message:', result.message);
      console.log('  - Carriers synced:', result.carrierCount);
      console.log('  - File path:', result.filePath);
      console.log('  - Timestamp:', result.timestamp);
    } else {
      console.log('❌ Carrier sync failed!');
      console.log('  - Message:', result.message);
      console.log('  - Timestamp:', result.timestamp);
    }
    
  } catch (error) {
    console.error('💥 Manual carrier sync failed:', error.message);
  }
}

// Run the manual sync
manualCarrierSync(); 