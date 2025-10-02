const shipwayCarrierService = require('../services/shipwayCarrierService');

async function testCarrierSync() {
  try {
    console.log('🚀 CARRIER SYNC TEST: Starting test...');
    
    // Test 1: Fetch carriers from Shipway API
    console.log('\n📡 TEST 1: Fetching carriers from Shipway API...');
    const shipwayData = await shipwayCarrierService.fetchCarriersFromShipway();
    console.log('✅ API Response received');
    console.log('  - Response type:', typeof shipwayData);
    console.log('  - Response keys:', Object.keys(shipwayData || {}));
    
    // Test 2: Extract carrier data
    console.log('\n🔍 TEST 2: Extracting carrier data...');
    const carriers = shipwayCarrierService.extractCarrierData(shipwayData);
    console.log('✅ Data extraction completed');
    console.log('  - Total carriers extracted:', carriers.length);
    
    if (carriers.length > 0) {
      console.log('  - Sample carrier:', carriers[0]);
    }
    
    // Test 3: Save to Excel
    console.log('\n💾 TEST 3: Saving to Excel...');
    const result = shipwayCarrierService.saveCarriersToExcel(carriers);
    console.log('✅ Excel save completed');
    console.log('  - Result:', result);
    
    // Test 4: Read from Excel
    console.log('\n📖 TEST 4: Reading from Excel...');
    const readCarriers = shipwayCarrierService.readCarriersFromExcel();
    console.log('✅ Excel read completed');
    console.log('  - Total carriers read:', readCarriers.length);
    
    if (readCarriers.length > 0) {
      console.log('  - Sample read carrier:', readCarriers[0]);
    }
    
    console.log('\n🎉 CARRIER SYNC TEST: All tests completed successfully!');
    
  } catch (error) {
    console.error('\n💥 CARRIER SYNC TEST: Test failed:', error.message);
    console.error('  - Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
testCarrierSync(); 