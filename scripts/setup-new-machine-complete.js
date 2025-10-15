const mysql = require('mysql2/promise');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Complete Setup Script for New Machine
 * This script will:
 * 1. Create database and all tables
 * 2. Migrate users from Excel to MySQL
 * 3. Migrate carriers from Excel to MySQL
 * 4. Migrate settlements from Excel to MySQL
 * 5. Migrate transactions from Excel to MySQL
 */

class NewMachineSetup {
  constructor() {
    this.dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'root',
      database: process.env.DB_NAME || 'clamio_v3'
    };
    this.connection = null;
  }

  async connectToMySQL() {
    try {
      console.log('🔗 Connecting to MySQL...');
      console.log(`  - Host: ${this.dbConfig.host}`);
      console.log(`  - User: ${this.dbConfig.user}`);
      console.log(`  - Database: ${this.dbConfig.database}`);
      
      // First connect without database to create it
      const tempConnection = await mysql.createConnection({
        host: this.dbConfig.host,
        user: this.dbConfig.user,
        password: this.dbConfig.password
      });
      
      // Create database if it doesn't exist
      await tempConnection.execute(`CREATE DATABASE IF NOT EXISTS ${this.dbConfig.database}`);
      console.log(`✅ Database '${this.dbConfig.database}' created/verified`);
      
      // Close temp connection
      await tempConnection.end();
      
      // Now connect to the specific database
      this.connection = await mysql.createConnection(this.dbConfig);
      console.log('✅ Connected to MySQL successfully');
      
    } catch (error) {
      console.error('❌ MySQL connection failed:', error.message);
      throw error;
    }
  }

  async createAllTables() {
    try {
      console.log('\n📊 Creating all database tables...');
      
      // 1. Carriers table
      await this.connection.execute(`
        CREATE TABLE IF NOT EXISTS carriers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          carrier_id VARCHAR(100) UNIQUE NOT NULL,
          carrier_name VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'Active',
          weight_in_kg DECIMAL(10,2),
          priority INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_priority (priority),
          INDEX idx_carrier_id (carrier_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Carriers table created/verified');

      // 2. Products table
      await this.connection.execute(`
        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(500) NOT NULL,
          image VARCHAR(500),
          altText TEXT,
          totalImages INTEGER DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Products table created/verified');

      // 3. Users table
      await this.connection.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          phone VARCHAR(20),
          password VARCHAR(255),
          role VARCHAR(50) NOT NULL,
          status VARCHAR(50) DEFAULT 'active',
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          lastLogin TIMESTAMP NULL,
          token VARCHAR(255),
          active_session VARCHAR(10),
          contactNumber VARCHAR(255),
          warehouseId VARCHAR(50),
          address TEXT,
          city VARCHAR(100),
          pincode VARCHAR(20),
          INDEX idx_email (email),
          INDEX idx_warehouseId (warehouseId),
          INDEX idx_token (token),
          INDEX idx_role (role)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Users table created/verified');

      // 4. Settlements table
      await this.connection.execute(`
        CREATE TABLE IF NOT EXISTS settlements (
          id VARCHAR(50) PRIMARY KEY,
          vendorId VARCHAR(50),
          vendorName VARCHAR(255),
          amount DECIMAL(10,2),
          upiId VARCHAR(255),
          orderIds TEXT,
          numberOfOrders INTEGER,
          currency VARCHAR(10) DEFAULT 'INR',
          status VARCHAR(50) DEFAULT 'pending',
          paymentStatus VARCHAR(50) DEFAULT 'pending',
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          amountPaid DECIMAL(10,2) DEFAULT 0,
          transactionId VARCHAR(255),
          paymentProofPath VARCHAR(500),
          approvedBy VARCHAR(50),
          approvedAt TIMESTAMP NULL,
          rejectionReason TEXT,
          rejectedBy VARCHAR(50),
          rejectedAt TIMESTAMP NULL,
          INDEX idx_vendorId (vendorId),
          INDEX idx_status (status),
          INDEX idx_paymentStatus (paymentStatus),
          INDEX idx_createdAt (createdAt)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Settlements table created/verified');

      // 5. Transactions table
      await this.connection.execute(`
        CREATE TABLE IF NOT EXISTS transactions (
          id VARCHAR(50) PRIMARY KEY,
          vendor_id VARCHAR(50),
          amount DECIMAL(10,2),
          type VARCHAR(50),
          description TEXT,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_vendor_id (vendor_id),
          INDEX idx_type (type),
          INDEX idx_createdAt (createdAt)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Transactions table created/verified');

      // 6. Orders table
      await this.connection.execute(`
        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(50) PRIMARY KEY,
          unique_id VARCHAR(100) UNIQUE,
          order_id VARCHAR(100),
          customer_name VARCHAR(255),
          order_date DATETIME,
          product_name VARCHAR(500),
          product_code VARCHAR(100),
          quantity INT,
          selling_price DECIMAL(10,2),
          order_total DECIMAL(10,2),
          payment_type VARCHAR(50),
          prepaid_amount DECIMAL(10,2),
          order_total_ratio DECIMAL(10,2),
          order_total_split DECIMAL(10,2),
          collectable_amount DECIMAL(10,2),
          pincode VARCHAR(20),
          status VARCHAR(50),
          claimed_by VARCHAR(50),
          claimed_at TIMESTAMP NULL,
          last_claimed_by VARCHAR(50),
          last_claimed_at TIMESTAMP NULL,
          clone_status VARCHAR(50),
          cloned_order_id VARCHAR(100),
          is_cloned_row BOOLEAN DEFAULT FALSE,
          label_downloaded BOOLEAN DEFAULT FALSE,
          handover_at TIMESTAMP NULL,
          priority_carrier VARCHAR(50),
          INDEX idx_unique_id (unique_id),
          INDEX idx_order_id (order_id),
          INDEX idx_claimed_by (claimed_by),
          INDEX idx_status (status),
          INDEX idx_warehouse (claimed_by, status),
          INDEX idx_pincode (pincode),
          INDEX idx_order_date (order_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Orders table created/verified');

      // All indexes are already created within the table definitions above
      console.log('✅ All tables created successfully!');
      
    } catch (error) {
      console.error('❌ Error creating tables:', error.message);
      throw error;
    }
  }

  async migrateUsersFromExcel() {
    try {
      console.log('\n👥 Migrating users from Excel to MySQL...');
      
      const usersExcelPath = path.join(__dirname, '../data/users.xlsx');
      
      if (!fs.existsSync(usersExcelPath)) {
        console.log('⚠️  Users Excel file not found, skipping user migration');
        return;
      }

      const workbook = XLSX.readFile(usersExcelPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const users = XLSX.utils.sheet_to_json(worksheet);

      console.log(`📊 Found ${users.length} users in Excel file`);

      let migratedCount = 0;
      let skippedCount = 0;

      for (const user of users) {
        try {
          // Check if user already exists
          const [existing] = await this.connection.execute(
            'SELECT id FROM users WHERE email = ?',
            [user.email]
          );

          if (existing.length > 0) {
            console.log(`⚠️  User ${user.email} already exists, skipping`);
            skippedCount++;
            continue;
          }

          // Insert user
          await this.connection.execute(`
            INSERT INTO users (
              id, name, email, phone, password, role, status, 
              createdAt, updatedAt, lastLogin, token, active_session, 
              contactNumber, warehouseId, address, city, pincode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            user.id || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            user.name || '',
            user.email || '',
            user.phone || null,
            user.password || null,
            user.role || 'vendor',
            user.status || 'active',
            user.createdAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
            user.updatedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
            user.lastLogin || null,
            user.token || null,
            user.active_session || 'FALSE',
            user.contactNumber || null,
            user.warehouseId || null,
            user.address || null,
            user.city || null,
            user.pincode || null
          ]);

          migratedCount++;
          console.log(`✅ Migrated user: ${user.email}`);

        } catch (error) {
          console.error(`❌ Error migrating user ${user.email}:`, error.message);
        }
      }

      console.log(`✅ User migration completed: ${migratedCount} migrated, ${skippedCount} skipped`);

    } catch (error) {
      console.error('❌ Error in user migration:', error.message);
      throw error;
    }
  }

  async migrateCarriersFromExcel() {
    try {
      console.log('\n🚚 Migrating carriers from Excel to MySQL...');
      
      const carriersExcelPath = path.join(__dirname, '../data/carrier.xlsx');
      
      if (!fs.existsSync(carriersExcelPath)) {
        console.log('⚠️  Carriers Excel file not found, skipping carrier migration');
        return;
      }

      const workbook = XLSX.readFile(carriersExcelPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const carriers = XLSX.utils.sheet_to_json(worksheet);

      console.log(`📊 Found ${carriers.length} carriers in Excel file`);

      let migratedCount = 0;
      let skippedCount = 0;

      for (const carrier of carriers) {
        try {
          // Check if carrier already exists
          const [existing] = await this.connection.execute(
            'SELECT id FROM carriers WHERE carrier_id = ?',
            [carrier.carrier_id]
          );

          if (existing.length > 0) {
            console.log(`⚠️  Carrier ${carrier.carrier_id} already exists, skipping`);
            skippedCount++;
            continue;
          }

          // Insert carrier (id is AUTO_INCREMENT, so we don't specify it)
          await this.connection.execute(`
            INSERT INTO carriers (carrier_id, carrier_name, status, weight_in_kg, priority)
            VALUES (?, ?, ?, ?, ?)
          `, [
            carrier.carrier_id || '',
            carrier.carrier_name || '',
            carrier.status || 'Active',
            carrier.weight_in_kg || null,
            carrier.priority || 0
          ]);

          migratedCount++;
          console.log(`✅ Migrated carrier: ${carrier.carrier_name} (${carrier.carrier_id})`);

        } catch (error) {
          console.error(`❌ Error migrating carrier ${carrier.carrier_id}:`, error.message);
        }
      }

      console.log(`✅ Carrier migration completed: ${migratedCount} migrated, ${skippedCount} skipped`);

    } catch (error) {
      console.error('❌ Error in carrier migration:', error.message);
      throw error;
    }
  }

  async migrateSettlementsFromExcel() {
    try {
      console.log('\n💰 Migrating settlements from Excel to MySQL...');
      
      const settlementsExcelPath = path.join(__dirname, '../data/settlements.xlsx');
      
      if (!fs.existsSync(settlementsExcelPath)) {
        console.log('⚠️  Settlements Excel file not found, skipping settlement migration');
        return;
      }

      const workbook = XLSX.readFile(settlementsExcelPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const settlements = XLSX.utils.sheet_to_json(worksheet);

      console.log(`📊 Found ${settlements.length} settlements in Excel file`);

      let migratedCount = 0;
      let skippedCount = 0;

      for (const settlement of settlements) {
        try {
          // Check if settlement already exists
          const [existing] = await this.connection.execute(
            'SELECT id FROM settlements WHERE id = ?',
            [settlement.id]
          );

          if (existing.length > 0) {
            console.log(`⚠️  Settlement ${settlement.id} already exists, skipping`);
            skippedCount++;
            continue;
          }

          // Insert settlement
          await this.connection.execute(`
            INSERT INTO settlements (
              id, vendorId, vendorName, amount, upiId, orderIds, numberOfOrders,
              currency, status, paymentStatus, createdAt, updatedAt, amountPaid,
              transactionId, paymentProofPath, approvedBy, approvedAt, rejectionReason,
              rejectedBy, rejectedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            settlement.id || `settlement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            settlement.vendorId || null,
            settlement.vendorName || '',
            settlement.amount || 0,
            settlement.upiId || null,
            settlement.orderIds || null,
            settlement.numberOfOrders || 0,
            settlement.currency || 'INR',
            settlement.status || 'pending',
            settlement.paymentStatus || 'pending',
            settlement.createdAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
            settlement.updatedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
            settlement.amountPaid || 0,
            settlement.transactionId || null,
            settlement.paymentProofPath || null,
            settlement.approvedBy || null,
            settlement.approvedAt || null,
            settlement.rejectionReason || null,
            settlement.rejectedBy || null,
            settlement.rejectedAt || null
          ]);

          migratedCount++;
          console.log(`✅ Migrated settlement: ${settlement.id} - ${settlement.vendorName}`);

        } catch (error) {
          console.error(`❌ Error migrating settlement ${settlement.id}:`, error.message);
        }
      }

      console.log(`✅ Settlement migration completed: ${migratedCount} migrated, ${skippedCount} skipped`);

    } catch (error) {
      console.error('❌ Error in settlement migration:', error.message);
      throw error;
    }
  }

  async migrateTransactionsFromExcel() {
    try {
      console.log('\n💳 Migrating transactions from Excel to MySQL...');
      
      const transactionsExcelPath = path.join(__dirname, '../data/transactions.xlsx');
      
      if (!fs.existsSync(transactionsExcelPath)) {
        console.log('⚠️  Transactions Excel file not found, skipping transaction migration');
        return;
      }

      const workbook = XLSX.readFile(transactionsExcelPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const transactions = XLSX.utils.sheet_to_json(worksheet);

      console.log(`📊 Found ${transactions.length} transactions in Excel file`);

      let migratedCount = 0;
      let skippedCount = 0;

      for (const transaction of transactions) {
        try {
          // Check if transaction already exists
          const [existing] = await this.connection.execute(
            'SELECT id FROM transactions WHERE id = ?',
            [transaction.id]
          );

          if (existing.length > 0) {
            console.log(`⚠️  Transaction ${transaction.id} already exists, skipping`);
            skippedCount++;
            continue;
          }

          // Insert transaction
          await this.connection.execute(`
            INSERT INTO transactions (id, vendor_id, amount, type, description, createdAt)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [
            transaction.id || `transaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            transaction.vendor_id || null,
            transaction.amount || 0,
            transaction.type || '',
            transaction.description || '',
            transaction.createdAt || new Date().toISOString().slice(0, 19).replace('T', ' ')
          ]);

          migratedCount++;
          console.log(`✅ Migrated transaction: ${transaction.id} - ${transaction.type}`);

        } catch (error) {
          console.error(`❌ Error migrating transaction ${transaction.id}:`, error.message);
        }
      }

      console.log(`✅ Transaction migration completed: ${migratedCount} migrated, ${skippedCount} skipped`);

    } catch (error) {
      console.error('❌ Error in transaction migration:', error.message);
      throw error;
    }
  }

  async runCompleteSetup() {
    try {
      console.log('🚀 Starting Complete New Machine Setup');
      console.log('=====================================');
      
      // Step 1: Connect to MySQL
      await this.connectToMySQL();
      
      // Step 2: Create all tables
      await this.createAllTables();
      
      // Step 3: Migrate data from Excel
      await this.migrateUsersFromExcel();
      await this.migrateCarriersFromExcel();
      await this.migrateSettlementsFromExcel();
      await this.migrateTransactionsFromExcel();
      
      console.log('\n🎉 Complete setup finished successfully!');
      console.log('=====================================');
      console.log('✅ Database created and configured');
      console.log('✅ All tables created with indexes');
      console.log('✅ All Excel data migrated to MySQL');
      console.log('\n📝 Next steps:');
      console.log('1. Copy your .env file to the new machine');
      console.log('2. Run: npm install');
      console.log('3. Start your application: npm start');
      
    } catch (error) {
      console.error('\n💥 Setup failed:', error.message);
      throw error;
    } finally {
      if (this.connection) {
        await this.connection.end();
        console.log('\n🔌 Database connection closed');
      }
    }
  }
}

// Run the setup
async function main() {
  const setup = new NewMachineSetup();
  await setup.runCompleteSetup();
}

// Handle errors
main().catch(error => {
  console.error('💥 Setup script failed:', error);
  process.exit(1);
});
