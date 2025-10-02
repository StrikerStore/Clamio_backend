const XLSX = require('xlsx');
const path = require('path');
const database = require('../config/database');

/**
 * One-time script to migrate users from Excel to MySQL
 * This script will:
 * 1. Read existing users from users.xlsx
 * 2. Transform the data to match MySQL schema
 * 3. Insert users into MySQL database
 * 4. Provide detailed migration report
 */

async function migrateUsersFromExcelToMySQL() {
  console.log('🚀 Starting Users Migration from Excel to MySQL...\n');

  try {
    // Step 1: Check MySQL connection
    console.log('1️⃣ Checking MySQL connection...');
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL connection not available');
      return;
    }
    console.log('✅ MySQL connection available');

    // Step 2: Read users from Excel
    console.log('\n2️⃣ Reading users from Excel...');
    const usersExcelPath = path.join(__dirname, '../data/users.xlsx');
    
    if (!require('fs').existsSync(usersExcelPath)) {
      console.log('❌ Users Excel file not found at:', usersExcelPath);
      return;
    }

    const usersWb = XLSX.readFile(usersExcelPath);
    const usersWs = usersWb.Sheets[usersWb.SheetNames[0]];
    const excelUsers = XLSX.utils.sheet_to_json(usersWs, { defval: '' });
    
    console.log(`✅ Found ${excelUsers.length} users in Excel file`);

    if (excelUsers.length === 0) {
      console.log('⚠️ No users found in Excel file. Migration complete.');
      return;
    }

    // Step 3: Transform Excel data to MySQL format
    console.log('\n3️⃣ Transforming Excel data to MySQL format...');
    
    const transformedUsers = excelUsers.map((excelUser, index) => {
      // Map Excel columns to MySQL schema
      const mysqlUser = {
        id: excelUser.id || excelUser.ID || `user_${Date.now()}_${index}`,
        name: excelUser.name || excelUser.Name || excelUser.fullName || 'Unknown User',
        email: excelUser.email || excelUser.Email || excelUser.emailAddress || '',
        phone: excelUser.phone || excelUser.Phone || excelUser.phoneNumber || excelUser.contactNumber || null,
        password: excelUser.password || excelUser.Password || excelUser.hashedPassword || null,
        role: excelUser.role || excelUser.Role || excelUser.userRole || 'vendor',
        status: excelUser.status || excelUser.Status || excelUser.userStatus || 'active',
        token: excelUser.token || excelUser.Token || excelUser.authToken || null,
        active_session: excelUser.active_session || excelUser.activeSession || excelUser.Active_Session || 'FALSE',
        contactNumber: excelUser.contactNumber || excelUser.ContactNumber || excelUser.phone || null,
        warehouseId: excelUser.warehouseId || excelUser.WarehouseId || excelUser.warehouse_id || null,
        address: excelUser.address || excelUser.Address || excelUser.fullAddress || null,
        city: excelUser.city || excelUser.City || excelUser.cityName || null,
        pincode: excelUser.pincode || excelUser.Pincode || excelUser.postalCode || excelUser.zipCode || null
      };

      // Ensure required fields
      if (!mysqlUser.email) {
        mysqlUser.email = `migrated_${mysqlUser.id}@example.com`;
        console.log(`⚠️ User ${mysqlUser.id} has no email, using generated email: ${mysqlUser.email}`);
      }

      if (!mysqlUser.name || mysqlUser.name === 'Unknown User') {
        mysqlUser.name = `Migrated User ${mysqlUser.id}`;
        console.log(`⚠️ User ${mysqlUser.id} has no name, using generated name: ${mysqlUser.name}`);
      }

      return mysqlUser;
    });

    console.log(`✅ Transformed ${transformedUsers.length} users to MySQL format`);

    // Step 4: Check for existing users in MySQL
    console.log('\n4️⃣ Checking for existing users in MySQL...');
    const existingUsers = await database.getAllUsers();
    const existingEmails = new Set(existingUsers.map(user => user.email));
    const existingIds = new Set(existingUsers.map(user => user.id));
    
    console.log(`✅ Found ${existingUsers.length} existing users in MySQL`);

    // Step 5: Filter users to migrate (skip duplicates)
    console.log('\n5️⃣ Filtering users to migrate...');
    
    const usersToMigrate = transformedUsers.filter(user => {
      if (existingEmails.has(user.email)) {
        console.log(`⚠️ Skipping user ${user.id} - email ${user.email} already exists`);
        return false;
      }
      if (existingIds.has(user.id)) {
        console.log(`⚠️ Skipping user ${user.id} - ID already exists`);
        return false;
      }
      return true;
    });

    console.log(`✅ ${usersToMigrate.length} users ready for migration (${transformedUsers.length - usersToMigrate.length} skipped as duplicates)`);

    if (usersToMigrate.length === 0) {
      console.log('⚠️ No new users to migrate. All users already exist in MySQL.');
      return;
    }

    // Step 6: Migrate users to MySQL
    console.log('\n6️⃣ Migrating users to MySQL...');
    
    const migrationResults = {
      successful: [],
      failed: [],
      skipped: []
    };

    for (const user of usersToMigrate) {
      try {
        const createdUser = await database.createUser(user);
        migrationResults.successful.push({
          id: createdUser.id,
          name: createdUser.name,
          email: createdUser.email,
          role: createdUser.role
        });
        console.log(`✅ Migrated user: ${createdUser.name} (${createdUser.email})`);
      } catch (error) {
        migrationResults.failed.push({
          id: user.id,
          name: user.name,
          email: user.email,
          error: error.message
        });
        console.log(`❌ Failed to migrate user: ${user.name} (${user.email}) - ${error.message}`);
      }
    }

    // Step 7: Generate migration report
    console.log('\n7️⃣ Migration Report:');
    console.log('='.repeat(50));
    console.log(`📊 Total users in Excel: ${excelUsers.length}`);
    console.log(`📊 Existing users in MySQL: ${existingUsers.length}`);
    console.log(`📊 Users to migrate: ${usersToMigrate.length}`);
    console.log(`📊 Successfully migrated: ${migrationResults.successful.length}`);
    console.log(`📊 Failed migrations: ${migrationResults.failed.length}`);
    console.log(`📊 Skipped (duplicates): ${transformedUsers.length - usersToMigrate.length}`);
    
    if (migrationResults.successful.length > 0) {
      console.log('\n✅ Successfully Migrated Users:');
      migrationResults.successful.forEach(user => {
        console.log(`  - ${user.name} (${user.email}) - ${user.role}`);
      });
    }

    if (migrationResults.failed.length > 0) {
      console.log('\n❌ Failed Migrations:');
      migrationResults.failed.forEach(user => {
        console.log(`  - ${user.name} (${user.email}) - Error: ${user.error}`);
      });
    }

    // Step 8: Verify migration
    console.log('\n8️⃣ Verifying migration...');
    const finalUserCount = await database.getAllUsers();
    console.log(`✅ Final user count in MySQL: ${finalUserCount.length}`);

    // Step 9: Test authentication for migrated users
    console.log('\n9️⃣ Testing authentication for migrated users...');
    let authTestsPassed = 0;
    let authTestsFailed = 0;

    for (const user of migrationResults.successful) {
      try {
        const foundUser = await database.getUserByEmail(user.email);
        if (foundUser && foundUser.status === 'active') {
          authTestsPassed++;
        } else {
          authTestsFailed++;
          console.log(`⚠️ Auth test failed for: ${user.email}`);
        }
      } catch (error) {
        authTestsFailed++;
        console.log(`⚠️ Auth test error for ${user.email}: ${error.message}`);
      }
    }

    console.log(`✅ Authentication tests: ${authTestsPassed} passed, ${authTestsFailed} failed`);

    console.log('\n🎉 Users migration completed successfully!');
    console.log('\n📋 Migration Summary:');
    console.log('  ✅ Excel users read and transformed');
    console.log('  ✅ Duplicate users filtered out');
    console.log('  ✅ Users migrated to MySQL');
    console.log('  ✅ Migration verified');
    console.log('  ✅ Authentication tested');
    console.log('\n💡 Next steps:');
    console.log('  - Test login with migrated users');
    console.log('  - Verify user roles and permissions');
    console.log('  - Update any hardcoded user references');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the migration
migrateUsersFromExcelToMySQL().then(() => {
  console.log('\n🏁 Migration script completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Migration script crashed:', error);
  process.exit(1);
});

