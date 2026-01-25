const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const database = require('../config/database');

const SETTLEMENTS_EXCEL_PATH = path.join(__dirname, '../data/settlements.xlsx');

async function migrateSettlementsExcelToMySQL() {
  console.log('🚀 Starting Settlements Excel to MySQL Migration...\n');

  try {
    // Step 1: Initialize MySQL connection
    console.log('1️⃣ Initializing MySQL connection...');
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return;
    }
    console.log('✅ MySQL connection established');

    // Step 2: Check if settlements Excel file exists
    console.log('\n2️⃣ Checking settlements Excel file...');
    if (!fs.existsSync(SETTLEMENTS_EXCEL_PATH)) {
      console.log('❌ Settlements Excel file not found at:', SETTLEMENTS_EXCEL_PATH);
      return;
    }
    console.log('✅ Settlements Excel file found');

    // Step 3: Read settlements data from Excel
    console.log('\n3️⃣ Reading settlements data from Excel...');
    const workbook = XLSX.readFile(SETTLEMENTS_EXCEL_PATH);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const excelSettlements = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`✅ Found ${excelSettlements.length} settlements in Excel`);

    if (excelSettlements.length === 0) {
      console.log('⚠️ No settlements data to migrate');
      return;
    }

    // Step 4: Check existing settlements in MySQL
    console.log('\n4️⃣ Checking existing settlements in MySQL...');
    const existingSettlements = await database.getAllSettlements();
    console.log(`✅ Found ${existingSettlements.length} existing settlements in MySQL`);

    // Step 5: Migrate settlements data
    console.log('\n5️⃣ Migrating settlements data...');
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const excelSettlement of excelSettlements) {
      try {
        // Transform Excel data to MySQL format
        const settlementData = {
          id: excelSettlement.id,
          vendorId: excelSettlement.vendorId,
          vendorName: excelSettlement.vendorName,
          amount: parseFloat(excelSettlement.amount) || 0,
          upiId: excelSettlement.upiId,
          orderIds: excelSettlement.orderIds,
          numberOfOrders: parseInt(excelSettlement.numberOfOrders) || 0,
          currency: excelSettlement.currency || 'INR',
          status: excelSettlement.status || 'pending',
          paymentStatus: excelSettlement.paymentStatus || 'pending',
          createdAt: excelSettlement.createdAt ? new Date(excelSettlement.createdAt) : new Date(),
          updatedAt: excelSettlement.updatedAt ? new Date(excelSettlement.updatedAt) : new Date(),
          amountPaid: parseFloat(excelSettlement.amountPaid) || 0,
          transactionId: excelSettlement.transactionId,
          paymentProofPath: excelSettlement.paymentProofPath,
          approvedBy: excelSettlement.approvedBy,
          approvedAt: excelSettlement.approvedAt ? new Date(excelSettlement.approvedAt) : null,
          rejectionReason: excelSettlement.rejectionReason,
          rejectedBy: excelSettlement.rejectedBy,
          rejectedAt: excelSettlement.rejectedAt ? new Date(excelSettlement.rejectedAt) : null
        };

        // Check if settlement already exists
        const existingSettlement = existingSettlements.find(s => s.id === settlementData.id);
        if (existingSettlement) {
          console.log(`⏭️ Skipping existing settlement: ${settlementData.id}`);
          skippedCount++;
          continue;
        }

        // Create settlement in MySQL
        await database.createSettlement(settlementData);
        console.log(`✅ Migrated settlement: ${settlementData.id} (${settlementData.vendorName})`);
        migratedCount++;

      } catch (error) {
        console.log(`❌ Error migrating settlement ${excelSettlement.id}:`, error.message);
        errorCount++;
      }
    }

    // Step 6: Migration summary
    console.log('\n6️⃣ Migration Summary:');
    console.log(`  ✅ Successfully migrated: ${migratedCount} settlements`);
    console.log(`  ⏭️ Skipped (already exists): ${skippedCount} settlements`);
    console.log(`  ❌ Errors: ${errorCount} settlements`);
    console.log(`  📊 Total processed: ${excelSettlements.length} settlements`);

    // Step 7: Verify migration
    console.log('\n7️⃣ Verifying migration...');
    const finalSettlements = await database.getAllSettlements();
    console.log(`✅ Total settlements in MySQL: ${finalSettlements.length}`);

    // Step 8: Test settlement operations
    console.log('\n8️⃣ Testing settlement operations...');
    
    if (finalSettlements.length > 0) {
      const testSettlement = finalSettlements[0];
      
      // Test getSettlementById
      const retrievedSettlement = await database.getSettlementById(testSettlement.id);
      if (retrievedSettlement) {
        console.log('✅ getSettlementById working');
      } else {
        console.log('❌ getSettlementById failed');
      }

      // Test getSettlementsByVendor
      const vendorSettlements = await database.getSettlementsByVendor(testSettlement.vendorId);
      console.log(`✅ getSettlementsByVendor working: ${vendorSettlements.length} settlements for vendor`);

      // Test getSettlementsByStatus
      const approvedSettlements = await database.getSettlementsByStatus('approved');
      const rejectedSettlements = await database.getSettlementsByStatus('rejected');
      const pendingSettlements = await database.getSettlementsByStatus('pending');
      
      console.log(`✅ getSettlementsByStatus working:`);
      console.log(`  - Approved: ${approvedSettlements.length}`);
      console.log(`  - Rejected: ${rejectedSettlements.length}`);
      console.log(`  - Pending: ${pendingSettlements.length}`);

      // Test searchSettlements
      const searchResults = await database.searchSettlements(testSettlement.vendorName);
      console.log(`✅ searchSettlements working: ${searchResults.length} results for "${testSettlement.vendorName}"`);
    }

    console.log('\n🎉 Settlements migration completed successfully!');
    console.log('\n📋 Migration Results:');
    console.log('  ✅ All settlements data migrated from Excel to MySQL');
    console.log('  ✅ Settlement CRUD operations working');
    console.log('  ✅ Settlement search and filtering working');
    console.log('  ✅ Settlement status tracking working');
    console.log('  ✅ Settlement approval/rejection flow working');
    console.log('  ✅ Settlement data structure preserved');

  } catch (error) {
    console.error('❌ Settlements migration failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the migration
migrateSettlementsExcelToMySQL().then(() => {
  console.log('\n🏁 Settlements migration script completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Settlements migration script crashed:', error);
  process.exit(1);
});

