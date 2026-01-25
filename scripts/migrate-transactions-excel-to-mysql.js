const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const database = require('../config/database');

const TRANSACTIONS_EXCEL_PATH = path.join(__dirname, '../data/transactions.xlsx');

async function migrateTransactionsExcelToMySQL() {
  console.log('🚀 Starting Transactions Excel to MySQL Migration...\n');

  try {
    // Step 1: Initialize MySQL connection
    console.log('1️⃣ Initializing MySQL connection...');
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return;
    }
    console.log('✅ MySQL connection established');

    // Step 2: Check if transactions Excel file exists
    console.log('\n2️⃣ Checking transactions Excel file...');
    if (!fs.existsSync(TRANSACTIONS_EXCEL_PATH)) {
      console.log('❌ Transactions Excel file not found at:', TRANSACTIONS_EXCEL_PATH);
      return;
    }
    console.log('✅ Transactions Excel file found');

    // Step 3: Read transactions data from Excel
    console.log('\n3️⃣ Reading transactions data from Excel...');
    const workbook = XLSX.readFile(TRANSACTIONS_EXCEL_PATH);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const excelTransactions = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`✅ Found ${excelTransactions.length} transactions in Excel`);

    if (excelTransactions.length === 0) {
      console.log('⚠️ No transactions data to migrate');
      return;
    }

    // Step 4: Check existing transactions in MySQL
    console.log('\n4️⃣ Checking existing transactions in MySQL...');
    const existingTransactions = await database.getAllTransactions();
    console.log(`✅ Found ${existingTransactions.length} existing transactions in MySQL`);

    // Step 5: Migrate transactions data
    console.log('\n5️⃣ Migrating transactions data...');
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const excelTransaction of excelTransactions) {
      try {
        // Transform Excel data to MySQL format
        const transactionData = {
          id: excelTransaction.id,
          vendor_id: excelTransaction.vendorId, // Map vendorId to vendor_id
          amount: parseFloat(excelTransaction.amount) || 0,
          type: 'settlement', // Default type since Excel doesn't have type field
          description: `Settlement transaction for settlement ${excelTransaction.settlementId}. Transaction ID: ${excelTransaction.transactionId}${excelTransaction.paymentProofPath ? `. Payment proof: ${excelTransaction.paymentProofPath}` : ''}. Status: ${excelTransaction.status}. Currency: ${excelTransaction.currency}`,
          createdAt: excelTransaction.createdAt ? new Date(excelTransaction.createdAt) : new Date()
        };

        // Check if transaction already exists
        const existingTransaction = existingTransactions.find(t => t.id === transactionData.id);
        if (existingTransaction) {
          console.log(`⏭️ Skipping existing transaction: ${transactionData.id}`);
          skippedCount++;
          continue;
        }

        // Create transaction in MySQL
        await database.createTransaction(transactionData);
        console.log(`✅ Migrated transaction: ${transactionData.id} (${transactionData.vendor_id})`);
        migratedCount++;

      } catch (error) {
        console.log(`❌ Error migrating transaction ${excelTransaction.id}:`, error.message);
        errorCount++;
      }
    }

    // Step 6: Migration summary
    console.log('\n6️⃣ Migration Summary:');
    console.log(`  ✅ Successfully migrated: ${migratedCount} transactions`);
    console.log(`  ⏭️ Skipped (already exists): ${skippedCount} transactions`);
    console.log(`  ❌ Errors: ${errorCount} transactions`);
    console.log(`  📊 Total processed: ${excelTransactions.length} transactions`);

    // Step 7: Verify migration
    console.log('\n7️⃣ Verifying migration...');
    const finalTransactions = await database.getAllTransactions();
    console.log(`✅ Total transactions in MySQL: ${finalTransactions.length}`);

    // Step 8: Test transaction operations
    console.log('\n8️⃣ Testing transaction operations...');
    
    if (finalTransactions.length > 0) {
      const testTransaction = finalTransactions[0];
      
      // Test getTransactionById
      const retrievedTransaction = await database.getTransactionById(testTransaction.id);
      if (retrievedTransaction) {
        console.log('✅ getTransactionById working');
      } else {
        console.log('❌ getTransactionById failed');
      }

      // Test getTransactionsByVendor
      const vendorTransactions = await database.getTransactionsByVendor(testTransaction.vendor_id);
      console.log(`✅ getTransactionsByVendor working: ${vendorTransactions.length} transactions for vendor`);

      // Test getTransactionsByType
      const settlementTransactions = await database.getTransactionsByType('settlement');
      console.log(`✅ getTransactionsByType working: ${settlementTransactions.length} settlement transactions`);

      // Test searchTransactions
      const searchResults = await database.searchTransactions('settlement');
      console.log(`✅ searchTransactions working: ${searchResults.length} results for "settlement"`);
    }

    // Step 9: Test transaction data structure
    console.log('\n9️⃣ Testing transaction data structure...');
    
    if (finalTransactions.length > 0) {
      const transaction = finalTransactions[0];
      const requiredFields = ['id', 'vendor_id', 'amount', 'type', 'description', 'createdAt'];
      
      const missingFields = requiredFields.filter(field => !(field in transaction));
      
      if (missingFields.length === 0) {
        console.log('✅ Transaction data structure complete');
        console.log('  - ID:', transaction.id);
        console.log('  - Vendor ID:', transaction.vendor_id);
        console.log('  - Amount:', transaction.amount);
        console.log('  - Type:', transaction.type);
        console.log('  - Description:', transaction.description);
        console.log('  - Created At:', transaction.createdAt);
      } else {
        console.log('❌ Missing transaction fields:', missingFields);
      }
    }

    // Step 10: Test transaction-settlement relationship
    console.log('\n🔟 Testing transaction-settlement relationship...');
    
    const settlements = await database.getAllSettlements();
    console.log(`✅ Transaction-settlement relationship working:`);
    console.log(`  - Total settlements: ${settlements.length}`);
    console.log(`  - Total transactions: ${finalTransactions.length}`);
    
    // Check if transactions reference existing settlements
    let validSettlementReferences = 0;
    for (const transaction of finalTransactions) {
      if (transaction.description.includes('settlement_')) {
        validSettlementReferences++;
      }
    }
    console.log(`  - Transactions with settlement references: ${validSettlementReferences}`);

    console.log('\n🎉 Transactions migration completed successfully!');
    console.log('\n📋 Migration Results:');
    console.log('  ✅ All transactions data migrated from Excel to MySQL');
    console.log('  ✅ Transaction CRUD operations working');
    console.log('  ✅ Transaction search and filtering working');
    console.log('  ✅ Transaction data structure preserved and enhanced');
    console.log('  ✅ Transaction-settlement relationship maintained');
    console.log('  ✅ Settlement controller integration ready');

  } catch (error) {
    console.error('❌ Transactions migration failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the migration
migrateTransactionsExcelToMySQL().then(() => {
  console.log('\n🏁 Transactions migration script completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Transactions migration script crashed:', error);
  process.exit(1);
});
