const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

/**
 * Database Configuration and Utilities
 * Handles all database operations using MySQL
 */
class Database {
  constructor() {
    this.mysqlConnection = null;
    this.mysqlInitialized = false;
    this.initializeMySQL();
  }

  /**
   * Initialize MySQL connection
   */
  async initializeMySQL() {
    try {
      // Get database configuration from environment variables
      const dbConfig = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
      };

      // Validate required environment variables
      if (!dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database) {
        throw new Error('Missing required database environment variables: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
      }

      // First try to connect without database to create it if needed
      let connection = await mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password
      });

      // Create database if it doesn't exist
      await connection.execute(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
      await connection.end();

      // Create connection pool for parallel query execution (20 connections)
      this.mysqlPool = mysql.createPool({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        timezone: '+05:30', // Set to IST (Indian Standard Time)
        connectionLimit: 20, // 20 connections in pool for parallel execution
        queueLimit: 0, // No limit on queued requests
        waitForConnections: true, // Wait if all connections are busy
        enableKeepAlive: true, // Keep connections alive
        keepAliveInitialDelay: 0 // Start keepalive immediately
      });
      
      // Keep mysqlConnection for backward compatibility (point to pool for single-connection operations)
      // Pool can be used as connection for single operations
      this.mysqlConnection = this.mysqlPool;
      
      console.log('✅ MySQL connection pool established with IST timezone (+05:30) - 20 connections available');
      await this.createUtilityTable();
      await this.createStoreInfoTable();
      await this.createCarriersTable();
      await this.createProductsTable();
      await this.createUsersTable();
      await this.createSettlementsTable();
      await this.createTransactionsTable();
      await this.createOrdersTable();
      await this.createClaimsTable();
      await this.createNotificationsTable();
      await this.createWhMappingTable();
      this.mysqlInitialized = true;
    } catch (error) {
      console.error('❌ MySQL connection pool failed:', error.message);
      // MySQL connection failed - application will not function without database
      this.mysqlPool = null;
      this.mysqlConnection = null;
      this.mysqlInitialized = true; // Mark as initialized even if failed
      throw new Error(`Database initialization failed: ${error.message}`);
    }
  }

  /**
   * Create utility table if it doesn't exist
   * This table stores system-wide configuration parameters
   */
  async createUtilityTable() {
    if (!this.mysqlConnection) return;

    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS utility (
          id INT AUTO_INCREMENT PRIMARY KEY,
          parameter VARCHAR(255) NOT NULL,
          value VARCHAR(500) NOT NULL,
          created_by VARCHAR(255) DEFAULT 'system',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_parameter (parameter),
          UNIQUE KEY unique_parameter_value (parameter, value)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Utility table created/verified');
      
      // Initialize with default parameters
      const initQueries = [
        `INSERT INTO utility (parameter, value, created_by)
         VALUES ('number_of_day_of_order_include', '60', 'system')
         ON DUPLICATE KEY UPDATE modified_at = modified_at`,
        `INSERT INTO utility (parameter, value, created_by)
         VALUES ('shipping_partner', 'Shipway', 'system')
         ON DUPLICATE KEY UPDATE modified_at = modified_at`
      ];
      
      for (const query of initQueries) {
        await this.mysqlConnection.execute(query);
      }
      console.log('✅ Utility table initialized with default parameters');
    } catch (error) {
      console.error('❌ Error creating utility table:', error.message);
    }
  }

  /**
   * Create carriers table if it doesn't exist
   */
  async createCarriersTable() {
    if (!this.mysqlConnection) return;

    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS carriers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          carrier_id VARCHAR(100) NOT NULL,
          carrier_name VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'Active',
          weight_in_kg DECIMAL(10,2),
          priority INTEGER NOT NULL,
          account_code VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_priority (priority),
          INDEX idx_carrier_id (carrier_id),
          INDEX idx_account_code (account_code),
          UNIQUE KEY unique_carrier_store (carrier_id, account_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Carriers table created/verified');

      // Add account_code column if it doesn't exist (for existing tables)
      await this.addAccountCodeToCarriersIfNotExists();
    } catch (error) {
      console.error('❌ Error creating carriers table:', error.message);
    }
  }

  /**
   * Add account_code column to existing carriers table if it doesn't exist (migration)
   */
  async addAccountCodeToCarriersIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if account_code column exists in carriers table
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM carriers LIKE 'account_code'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding account_code column to existing carriers table...');
        
        // Add account_code column as NOT NULL (will require data migration for existing rows)
        await this.mysqlConnection.execute(
          `ALTER TABLE carriers ADD COLUMN account_code VARCHAR(50) NOT NULL AFTER priority`
        );
        
        // Add index for account_code
        await this.mysqlConnection.execute(
          `ALTER TABLE carriers ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to carriers table');
      } else {
        console.log('✅ account_code column already exists in carriers table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code column to carriers table:', error.message);
    }
  }

  /**
   * Create products table if it doesn't exist
   */
  async createProductsTable() {
    if (!this.mysqlConnection) return;

    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(500) NOT NULL,
          image VARCHAR(500),
          altText TEXT,
          totalImages INTEGER DEFAULT 0,
          sku_id VARCHAR(100),
          account_code VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_account_code (account_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Products table created/verified');

      // Add sku_id column if it doesn't exist (for existing tables)
      try {
        await this.mysqlConnection.execute(`
          ALTER TABLE products 
          ADD COLUMN sku_id VARCHAR(100)
        `);
        console.log('✅ Added sku_id column to products table');
      } catch (error) {
        // Column might already exist, check if it's the expected error
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('ℹ️ sku_id column already exists in products table');
        } else {
          console.error('❌ Error adding sku_id column to products table:', error.message);
        }
      }

      // Add account_code column if it doesn't exist (for existing tables)
      await this.addAccountCodeToProductsIfNotExists();

      // Add created_at column if it doesn't exist
      try {
        await this.mysqlConnection.execute(`
          ALTER TABLE products 
          ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `);
        console.log('✅ Added created_at column to products table');
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('ℹ️ created_at column already exists in products table');
        } else {
          console.error('❌ Error adding created_at column to products table:', error.message);
        }
      }

      // Add updated_at column if it doesn't exist
      try {
        await this.mysqlConnection.execute(`
          ALTER TABLE products 
          ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        `);
        console.log('✅ Added updated_at column to products table');
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('ℹ️ updated_at column already exists in products table');
        } else {
          console.error('❌ Error adding updated_at column to products table:', error.message);
        }
      }
    } catch (error) {
      console.error('❌ Error creating products table:', error.message);
    }
  }

  /**
   * Add account_code column to existing products table if it doesn't exist (migration)
   */
  async addAccountCodeToProductsIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if account_code column exists in products table
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM products LIKE 'account_code'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding account_code column to existing products table...');
        
        // Add account_code column as NOT NULL (will require data migration for existing rows)
        await this.mysqlConnection.execute(
          `ALTER TABLE products ADD COLUMN account_code VARCHAR(50) NOT NULL AFTER sku_id`
        );
        
        // Add index for account_code
        await this.mysqlConnection.execute(
          `ALTER TABLE products ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to products table');
      } else {
        console.log('✅ account_code column already exists in products table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code column to products table:', error.message);
    }
  }

  /**
   * Create users table if it doesn't exist
   */
  async createUsersTable() {
    if (!this.mysqlConnection) return;

    try {
      const createTableQuery = `
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
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Users table created/verified');
    } catch (error) {
      console.error('❌ Error creating users table:', error.message);
    }
  }

  /**
   * Create settlements table if it doesn't exist
   */
  async createSettlementsTable() {
    if (!this.mysqlConnection) return;

    try {
      const createTableQuery = `
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
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Settlements table created/verified');
    } catch (error) {
      console.error('❌ Error creating settlements table:', error.message);
    }
  }

  /**
   * Create transactions table if it doesn't exist
   */
  async createTransactionsTable() {
    if (!this.mysqlConnection) return;

    try {
      const createTableQuery = `
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
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Transactions table created/verified');
    } catch (error) {
      console.error('❌ Error creating transactions table:', error.message);
    }
  }

  /**
   * Create orders table if it doesn't exist
   */
  async createOrdersTable() {
    if (!this.mysqlConnection) return;

    try {
      // Create orders table if it doesn't exist (preserve existing data)
      console.log('🔄 Creating orders table if it doesn\'t exist...');

      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(255) PRIMARY KEY,
          unique_id VARCHAR(100) UNIQUE,
          order_id VARCHAR(100),
          customer_name VARCHAR(255),
          order_date DATETIME,
          product_name VARCHAR(500),
          product_code VARCHAR(100),
          size VARCHAR(20),
          quantity INT,
          selling_price DECIMAL(10,2),
          order_total DECIMAL(10,2),
          payment_type VARCHAR(50),
          is_partial_paid BOOLEAN DEFAULT 0,
          prepaid_amount DECIMAL(10,2),
          order_total_ratio DECIMAL(10,2),
          order_total_split DECIMAL(10,2),
          collectable_amount DECIMAL(10,2),
          pincode VARCHAR(20),
          is_in_new_order BOOLEAN DEFAULT 1,
          account_code VARCHAR(50) NOT NULL,
          INDEX idx_unique_id (unique_id),
          INDEX idx_order_id (order_id),
          INDEX idx_pincode (pincode),
          INDEX idx_order_date (order_date),
          INDEX idx_size (size),
          INDEX idx_account_code (account_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Fresh orders table created with clean structure');

      // Add size column to existing tables if it doesn't exist (migration)
      await this.addSizeColumnIfNotExists();

      // Increase id column size if needed (migration)
      await this.increaseIdColumnSizeIfNeeded();

      // Add account_code column if it doesn't exist (for existing tables)
      await this.addAccountCodeToOrdersIfNotExists();

      // Create labels table for caching label URLs
      await this.createLabelsTable();

      // Create order tracking table for shipment tracking
      await this.createOrderTrackingTable();

      // Create customer info table for storing customer details
      await this.createCustomerInfoTable();
    } catch (error) {
      console.error('❌ Error creating orders table:', error.message);
    }
  }

  /**
   * Add size column to existing orders table if it doesn't exist (migration)
   */
  async addSizeColumnIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if size column exists
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM orders LIKE 'size'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding size column to existing orders table...');
        
        // Add size column
        await this.mysqlConnection.execute(
          `ALTER TABLE orders ADD COLUMN size VARCHAR(20) AFTER product_code`
        );
        
        // Add index for size column
        await this.mysqlConnection.execute(
          `ALTER TABLE orders ADD INDEX idx_size (size)`
        );
        
        console.log('✅ Size column added to orders table');
        
        // Update existing orders with extracted size
        await this.updateExistingOrdersWithSize();
      } else {
        console.log('✅ Size column already exists in orders table');
      }
    } catch (error) {
      console.error('❌ Error adding size column:', error.message);
    }
  }

  /**
   * Increase id column size if it's too small (migration)
   */
  /**
   * Add account_code column to existing orders table if it doesn't exist (migration)
   */
  async addAccountCodeToOrdersIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if account_code column exists in orders table
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM orders LIKE 'account_code'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding account_code column to existing orders table...');
        
        // Add account_code column as NOT NULL (will require data migration for existing rows)
        await this.mysqlConnection.execute(
          `ALTER TABLE orders ADD COLUMN account_code VARCHAR(50) NOT NULL AFTER is_in_new_order`
        );
        
        // Add index for account_code
        await this.mysqlConnection.execute(
          `ALTER TABLE orders ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to orders table');
      } else {
        console.log('✅ account_code column already exists in orders table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code column to orders table:', error.message);
    }
  }

  async increaseIdColumnSizeIfNeeded() {
    if (!this.mysqlConnection) return;

    try {
      // Check current id column size
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM orders WHERE Field = 'id'`
      );

      if (columns.length > 0) {
        const idColumn = columns[0];
        const currentType = idColumn.Type.toUpperCase();
        
        // Check if it's VARCHAR(50) or smaller
        const match = currentType.match(/VARCHAR\((\d+)\)/);
        if (match) {
          const currentSize = parseInt(match[1]);
          if (currentSize < 255) {
            console.log(`🔄 Increasing id column size from VARCHAR(${currentSize}) to VARCHAR(255)...`);
            
            // Note: Don't specify PRIMARY KEY here - MySQL preserves it when modifying the column
            await this.mysqlConnection.execute(
              `ALTER TABLE orders MODIFY COLUMN id VARCHAR(255)`
            );
            
            console.log('✅ id column size increased to VARCHAR(255)');
          } else {
            console.log(`✅ id column size is already VARCHAR(${currentSize})`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error increasing id column size:', error.message);
    }
  }

  /**
   * Update existing orders with extracted size information
   */
  async updateExistingOrdersWithSize() {
    if (!this.mysqlConnection) return;

    try {
      console.log('🔄 Updating existing orders with size information...');
      
      // Get all orders that don't have size information
      const [orders] = await this.mysqlConnection.execute(
        `SELECT unique_id, product_code FROM orders WHERE size IS NULL AND product_code IS NOT NULL`
      );

      let updatedCount = 0;
      for (const order of orders) {
        const extractedSize = this.extractSizeFromSku(order.product_code);
        if (extractedSize) {
          await this.mysqlConnection.execute(
            `UPDATE orders SET size = ? WHERE unique_id = ?`,
            [extractedSize, order.unique_id]
          );
          updatedCount++;
        }
      }

      console.log(`✅ Updated ${updatedCount} orders with size information`);
    } catch (error) {
      console.error('❌ Error updating existing orders with size:', error.message);
    }
  }

  /**
   * Create labels table for caching label URLs
   */
  async createLabelsTable() {
    try {
      // Create labels table if it doesn't exist (preserve existing data)
      console.log('🔄 Creating labels table if not exists...');

      const createLabelsTableQuery = `
        CREATE TABLE IF NOT EXISTS labels (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id VARCHAR(100) UNIQUE NOT NULL,
          label_url VARCHAR(1000),
          awb VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          carrier_id VARCHAR(100),
          carrier_name VARCHAR(255),
          handover_at TIMESTAMP NULL,
          priority_carrier VARCHAR(50),
          is_manifest TINYINT(1) DEFAULT 0,
          is_handover TINYINT(1) DEFAULT 0,
          current_shipment_status VARCHAR(100) NULL,
          manifest_id VARCHAR(100) NULL,
          account_code VARCHAR(50) NOT NULL,
          INDEX idx_order_id (order_id),
          INDEX idx_awb (awb),
          INDEX idx_carrier_id (carrier_id),
          INDEX idx_priority_carrier (priority_carrier),
          INDEX idx_is_manifest (is_manifest),
          INDEX idx_is_handover (is_handover),
          INDEX idx_current_shipment_status (current_shipment_status),
          INDEX idx_manifest_id (manifest_id),
          INDEX idx_account_code (account_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createLabelsTableQuery);
      console.log('✅ Labels table created/verified (existing data preserved)');
      
      // Add is_manifest column if it doesn't exist (for existing tables)
      try {
        await this.mysqlConnection.execute(`
          ALTER TABLE labels 
          ADD COLUMN is_manifest TINYINT(1) DEFAULT 0,
          ADD INDEX idx_is_manifest (is_manifest)
        `);
        console.log('✅ Added is_manifest column to labels table');
      } catch (error) {
        // Column might already exist, check if it's the expected error
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('ℹ️ is_manifest column already exists in labels table');
        } else {
          console.error('❌ Error adding is_manifest column to labels table:', error.message);
        }
      }
      
      // Add is_handover column if it doesn't exist (for existing tables)
      try {
        await this.mysqlConnection.execute(`
          ALTER TABLE labels 
          ADD COLUMN is_handover TINYINT(1) DEFAULT 0,
          ADD INDEX idx_is_handover (is_handover)
        `);
        console.log('✅ Added is_handover column to labels table');
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('ℹ️ is_handover column already exists in labels table');
        } else {
          console.error('❌ Error adding is_handover column to labels table:', error.message);
        }
      }

      // Add current_shipment_status column if it doesn't exist (for existing tables)
      try {
        await this.mysqlConnection.execute(`
          ALTER TABLE labels 
          ADD COLUMN current_shipment_status VARCHAR(100) NULL,
          ADD INDEX idx_current_shipment_status (current_shipment_status)
        `);
        console.log('✅ Added current_shipment_status column to labels table');
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('ℹ️ current_shipment_status column already exists in labels table');
        } else {
          console.error('❌ Error adding current_shipment_status column to labels table:', error.message);
        }
      }

      // Add manifest_id column if it doesn't exist (for existing tables)
      try {
        await this.mysqlConnection.execute(`
          ALTER TABLE labels 
          ADD COLUMN manifest_id VARCHAR(100) NULL,
          ADD INDEX idx_manifest_id (manifest_id)
        `);
        console.log('✅ Added manifest_id column to labels table');
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('ℹ️ manifest_id column already exists in labels table');
        } else {
          console.error('❌ Error adding manifest_id column to labels table:', error.message);
        }
      }

      // Add account_code column if it doesn't exist (for existing tables)
      await this.addAccountCodeToLabelsIfNotExists();
      
      } catch (error) {
      console.error('❌ Error creating labels table:', error.message);
    }
  }

  /**
   * Add account_code column to existing labels table if it doesn't exist (migration)
   */
  async addAccountCodeToLabelsIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if account_code column exists in labels table
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM labels LIKE 'account_code'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding account_code column to existing labels table...');
        
        // Add account_code column as NOT NULL (will require data migration for existing rows)
        await this.mysqlConnection.execute(
          `ALTER TABLE labels ADD COLUMN account_code VARCHAR(50) NOT NULL AFTER manifest_id`
        );
        
        // Add index for account_code
        await this.mysqlConnection.execute(
          `ALTER TABLE labels ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to labels table');
      } else {
        console.log('✅ account_code column already exists in labels table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code column to labels table:', error.message);
    }
  }

  /**
   * Create order tracking table for shipment tracking data
   */
  async createOrderTrackingTable() {
    if (!this.mysqlConnection) return;

    try {
      console.log('🔄 Creating order tracking table...');

      const createOrderTrackingTableQuery = `
        CREATE TABLE IF NOT EXISTS order_tracking (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id VARCHAR(100) NOT NULL,
          order_type ENUM('active', 'inactive') NOT NULL,
          shipment_status VARCHAR(100) NOT NULL,
          timestamp DATETIME NOT NULL,
          ndr_reason VARCHAR(255) NULL,
          account_code VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          
          -- Indexes for performance
          INDEX idx_order_id (order_id),
          INDEX idx_order_type (order_type),
          INDEX idx_timestamp (timestamp),
          INDEX idx_shipment_status (shipment_status),
          INDEX idx_order_timestamp (order_id, timestamp),
          INDEX idx_order_type_status (order_id, order_type),
          INDEX idx_account_code (account_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createOrderTrackingTableQuery);
      console.log('✅ Order tracking table created/verified');

      // Add account_code column if it doesn't exist (for existing tables)
      await this.addAccountCodeToOrderTrackingIfNotExists();
    } catch (error) {
      console.error('❌ Error creating order tracking table:', error.message);
    }
  }

  /**
   * Add account_code column to existing order_tracking table if it doesn't exist (migration)
   */
  async addAccountCodeToOrderTrackingIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if account_code column exists in order_tracking table
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM order_tracking LIKE 'account_code'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding account_code column to existing order_tracking table...');
        
        // Add account_code column as NOT NULL (will require data migration for existing rows)
        await this.mysqlConnection.execute(
          `ALTER TABLE order_tracking ADD COLUMN account_code VARCHAR(50) NOT NULL AFTER ndr_reason`
        );
        
        // Add index for account_code
        await this.mysqlConnection.execute(
          `ALTER TABLE order_tracking ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to order_tracking table');
      } else {
        console.log('✅ account_code column already exists in order_tracking table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code column to order_tracking table:', error.message);
    }
  }

  /**
   * Create customer info table for storing customer contact details
   */
  async createCustomerInfoTable() {
    if (!this.mysqlConnection) return;

    try {
      console.log('🔄 Creating customer_info table...');

      const createCustomerInfoTableQuery = `
        CREATE TABLE IF NOT EXISTS customer_info (
          order_id VARCHAR(100) PRIMARY KEY,
          store_code VARCHAR(20),
          email VARCHAR(255),
          billing_firstname VARCHAR(100),
          billing_lastname VARCHAR(100),
          billing_phone VARCHAR(20),
          billing_address TEXT,
          billing_address2 TEXT,
          billing_city VARCHAR(100),
          billing_state VARCHAR(100),
          billing_country VARCHAR(10),
          billing_zipcode VARCHAR(20),
          billing_latitude VARCHAR(20),
          billing_longitude VARCHAR(20),
          shipping_firstname VARCHAR(100),
          shipping_lastname VARCHAR(100),
          shipping_phone VARCHAR(20),
          shipping_address TEXT,
          shipping_address2 TEXT,
          shipping_city VARCHAR(100),
          shipping_state VARCHAR(100),
          shipping_country VARCHAR(10),
          shipping_zipcode VARCHAR(20),
          shipping_latitude VARCHAR(20),
          shipping_longitude VARCHAR(20),
          account_code VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          
          INDEX idx_email (email),
          INDEX idx_billing_zipcode (billing_zipcode),
          INDEX idx_shipping_zipcode (shipping_zipcode),
          INDEX idx_account_code (account_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createCustomerInfoTableQuery);
      console.log('✅ Customer info table created/verified');

      // Add account_code column to existing customer_info table if it doesn't exist (migration)
      await this.addAccountCodeToCustomerInfoIfNotExists();
      
      // Add store_code column to existing customer_info table if it doesn't exist (migration)
      await this.addStoreCodeToCustomerInfoIfNotExists();
    } catch (error) {
      console.error('❌ Error creating customer info table:', error.message);
    }
  }

  /**
   * Add account_code column to existing customer_info table if it doesn't exist (migration)
   */
  async addAccountCodeToCustomerInfoIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if account_code column exists in customer_info table
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM customer_info LIKE 'account_code'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding account_code column to existing customer_info table...');
        
        // Add account_code column as NOT NULL (will require data migration for existing rows)
        await this.mysqlConnection.execute(
          `ALTER TABLE customer_info ADD COLUMN account_code VARCHAR(50) NOT NULL AFTER shipping_longitude`
        );
        
        // Add index for account_code
        await this.mysqlConnection.execute(
          `ALTER TABLE customer_info ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to customer_info table');
      } else {
        console.log('✅ account_code column already exists in customer_info table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code column to customer_info table:', error.message);
    }
  }

  /**
   * Add store_code column to existing customer_info table if it doesn't exist (migration)
   */
  async addStoreCodeToCustomerInfoIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if store_code column exists in customer_info table
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM customer_info LIKE 'store_code'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding store_code column to existing customer_info table...');
        
        // Add store_code column after order_id (to match production database structure)
        await this.mysqlConnection.execute(
          `ALTER TABLE customer_info ADD COLUMN store_code VARCHAR(20) AFTER order_id`
        );
        
        console.log('✅ store_code column added to customer_info table');
      } else {
        console.log('✅ store_code column already exists in customer_info table');
      }
    } catch (error) {
      console.error('❌ Error adding store_code column to customer_info table:', error.message);
    }
  }

  /**
   * Migrate labels data from orders table to labels table
   */
  async migrateLabelsData() {
    if (!this.mysqlConnection) return;

    try {
      console.log('🔄 Migrating labels data from orders table...');

      // Skip migration since labels table will be populated during label download process
      console.log('ℹ️ Labels table will be populated during label download process - no migration needed');

    } catch (error) {
      console.error('❌ Error migrating labels data:', error.message);
    }
  }

  /**
   * Create claims table for tracking claim history
   */
  async createClaimsTable() {
    if (!this.mysqlConnection) return;

    try {
      // First check if claims table exists and has the correct structure
      const [tables] = await this.mysqlConnection.execute(`
        SELECT COUNT(*) as count FROM information_schema.tables 
        WHERE table_schema = DATABASE() AND table_name = 'claims'
      `);
      
      const tableExists = tables[0].count > 0;
      
      if (tableExists) {
        // Check if the table has the correct structure (check for 'status' column)
        const [columns] = await this.mysqlConnection.execute(`
          SELECT COUNT(*) as count FROM information_schema.columns 
          WHERE table_schema = DATABASE() AND table_name = 'claims' AND column_name = 'status'
        `);
        
        const hasCorrectStructure = columns[0].count > 0;
        
        if (!hasCorrectStructure) {
          console.log('🔄 Claims table exists but has old structure, recreating...');
          // Drop the old table
          await this.mysqlConnection.execute('DROP TABLE claims');
        }
      }

      const createClaimsTableQuery = `
        CREATE TABLE IF NOT EXISTS claims (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_unique_id VARCHAR(100) NOT NULL UNIQUE,
          order_id VARCHAR(100) NOT NULL,
          status VARCHAR(50) DEFAULT 'unclaimed',
          claimed_by VARCHAR(50),
          claimed_at TIMESTAMP NULL,
          last_claimed_by VARCHAR(50),
          last_claimed_at TIMESTAMP NULL,
          clone_status VARCHAR(50) DEFAULT 'not_cloned',
          cloned_order_id VARCHAR(100),
          is_cloned_row BOOLEAN DEFAULT FALSE,
          label_downloaded BOOLEAN DEFAULT FALSE,
          priority_carrier TEXT,
          account_code VARCHAR(50) NOT NULL,
          INDEX idx_order_unique_id (order_unique_id),
          INDEX idx_order_id (order_id),
          INDEX idx_claimed_by (claimed_by),
          INDEX idx_status (status),
          INDEX idx_account_code (account_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createClaimsTableQuery);
      console.log('✅ Claims table created/verified');
      
      // Add priority_carrier column if it doesn't exist (migration for existing tables)
      await this.addPriorityCarrierColumnToClaims();

      // Add account_code column if it doesn't exist (for existing tables)
      await this.addAccountCodeToClaimsIfNotExists();
      
      // Migrate existing claims data from orders table if claims table is empty
      await this.migrateClaimsData();
    } catch (error) {
      console.error('❌ Error creating claims table:', error.message);
    }
  }

  /**
   * Add account_code column to existing claims table if it doesn't exist (migration)
   */
  async addAccountCodeToClaimsIfNotExists() {
    if (!this.mysqlConnection) return;

    try {
      // Check if account_code column exists in claims table
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM claims LIKE 'account_code'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding account_code column to existing claims table...');
        
        // Add account_code column as NOT NULL (will require data migration for existing rows)
        await this.mysqlConnection.execute(
          `ALTER TABLE claims ADD COLUMN account_code VARCHAR(50) NOT NULL AFTER priority_carrier`
        );
        
        // Add index for account_code
        await this.mysqlConnection.execute(
          `ALTER TABLE claims ADD INDEX idx_account_code (account_code)`
        );
        
        console.log('✅ account_code column added to claims table');
      } else {
        console.log('✅ account_code column already exists in claims table');
      }
    } catch (error) {
      console.error('❌ Error adding account_code column to claims table:', error.message);
    }
  }

  /**
   * Migrate claims data from orders table to claims table
   */
  async migrateClaimsData() {
    if (!this.mysqlConnection) return;

    try {
      // Check if claims table is empty
      const [claimsCount] = await this.mysqlConnection.execute('SELECT COUNT(*) as count FROM claims');
      
      if (claimsCount[0].count > 0) {
        console.log('✅ Claims table already has data, skipping migration');
        return;
      }

      console.log('🔄 Migrating claims data from orders table...');

      // Skip migration since claims table will be populated as orders are claimed
      console.log('ℹ️ Claims table will be populated as orders are claimed - no migration needed');

    } catch (error) {
      console.error('❌ Error migrating claims data:', error.message);
    }
  }

  /**
   * Add priority_carrier column to existing claims table if it doesn't exist (migration)
   */
  async addPriorityCarrierColumnToClaims() {
    if (!this.mysqlConnection) return;

    try {
      // Check if priority_carrier column exists
      const [columns] = await this.mysqlConnection.execute(
        `SHOW COLUMNS FROM claims LIKE 'priority_carrier'`
      );

      if (columns.length === 0) {
        console.log('🔄 Adding priority_carrier column to existing claims table...');
        
        // Add priority_carrier column
        await this.mysqlConnection.execute(
          `ALTER TABLE claims ADD COLUMN priority_carrier TEXT AFTER label_downloaded`
        );
        
        console.log('✅ priority_carrier column added to claims table');
      } else {
        console.log('✅ priority_carrier column already exists in claims table');
      }
    } catch (error) {
      console.error('❌ Error adding priority_carrier column to claims:', error.message);
    }
  }

  /**
   * Create notifications table for tracking system alerts
   */
  async createNotificationsTable() {
    if (!this.mysqlConnection) return;

    try {
      const createNotificationsTableQuery = `
        CREATE TABLE IF NOT EXISTS notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          
          -- Notification Core Info
         type ENUM(
           'reverse_order_failure',
           'shipment_assignment_error',
           'carrier_unavailable',
           'low_balance',
           'warehouse_issue',
           'payment_failed',
           'order_stuck',
           'vendor_error',
           'vendor_api_error',
           'vendor_connection_error',
           'vendor_validation_error',
           'vendor_timeout_error',
           'vendor_authentication_error',
           'order_claim_error',
           'order_processing_error',
           'label_download_error',
           'authentication_error',
           'data_fetch_error',
           'data_refresh_error',
           'settlement_error',
           'address_error',
           'file_upload_error',
           'file_download_error',
           'vendor_operation_error',
           'system_notification',
           'other'
         ) NOT NULL,
          severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          
          -- Related Entity Info
          order_id VARCHAR(100),
          vendor_id VARCHAR(50),
          vendor_name VARCHAR(255),
          vendor_warehouse_id VARCHAR(50),
          
          -- Additional Context
          metadata JSON,
          error_details TEXT,
          
          -- Status Tracking
          status ENUM('pending', 'in_progress', 'resolved', 'dismissed') DEFAULT 'pending',
          
          -- Resolution Info
          resolved_by VARCHAR(50),
          resolved_by_name VARCHAR(255),
          resolved_at DATETIME,
          resolution_notes TEXT,
          
          -- Timestamps
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          
          -- Indexes for performance
          INDEX idx_type (type),
          INDEX idx_status (status),
          INDEX idx_vendor (vendor_id),
          INDEX idx_order (order_id),
          INDEX idx_created_at (created_at),
          INDEX idx_severity (severity),
          
          -- Foreign key constraints
          FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createNotificationsTableQuery);
      console.log('✅ Notifications table created/verified');

      // Create notification_views table
      const createNotificationViewsTableQuery = `
        CREATE TABLE IF NOT EXISTS notification_views (
          id INT AUTO_INCREMENT PRIMARY KEY,
          notification_id INT NOT NULL,
          admin_id VARCHAR(50) NOT NULL,
          viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          
          UNIQUE KEY unique_view (notification_id, admin_id),
          FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
          FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
          
          INDEX idx_notification (notification_id),
          INDEX idx_admin (admin_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createNotificationViewsTableQuery);
      console.log('✅ Notification views table created/verified');

      // Create push_subscriptions table
      const createPushSubscriptionsTableQuery = `
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          admin_id VARCHAR(50) NOT NULL,
          endpoint TEXT NOT NULL,
          p256dh_key VARCHAR(255) NOT NULL,
          auth_key VARCHAR(255) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          
          UNIQUE KEY unique_admin_endpoint (admin_id, endpoint(255)),
          FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
          
          INDEX idx_admin (admin_id),
          INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createPushSubscriptionsTableQuery);
      console.log('✅ Push subscriptions table created/verified');

      // Create push_notification_logs table
      const createPushNotificationLogsTableQuery = `
        CREATE TABLE IF NOT EXISTS push_notification_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          notification_id INT NOT NULL,
          admin_id VARCHAR(50) NOT NULL,
          status ENUM('sent', 'failed', 'invalid_subscription') DEFAULT 'sent',
          error_message TEXT,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          
          INDEX idx_notification_id (notification_id),
          INDEX idx_admin_id (admin_id),
          INDEX idx_status (status),
          INDEX idx_sent_at (sent_at),
          
          FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
          FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createPushNotificationLogsTableQuery);
      console.log('✅ Push notification logs table created/verified');

      // Add push_notifications_enabled column to users table if it doesn't exist
      try {
        // Check if column already exists
        const [columns] = await this.mysqlConnection.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'users' 
          AND COLUMN_NAME = 'push_notifications_enabled'
          AND TABLE_SCHEMA = DATABASE()
        `);
        
        if (columns.length === 0) {
          await this.mysqlConnection.execute(`
            ALTER TABLE users 
            ADD COLUMN push_notifications_enabled BOOLEAN DEFAULT FALSE
          `);
          console.log('✅ Push notifications enabled column added to users table');
        } else {
          console.log('✅ Push notifications enabled column already exists in users table');
        }
      } catch (error) {
        console.error('❌ Error adding push_notifications_enabled column:', error.message);
      }

    } catch (error) {
      console.error('❌ Error creating notifications tables:', error.message);
    }
  }


  // Excel methods removed - users now use MySQL only

  // Excel-based user methods removed - now using MySQL only


  // All Excel-based user CRUD methods removed - now using MySQL only


  /**
   * Get users by status
   * @param {string} status - User status (active, inactive)
   * @returns {Array} Array of users with specified status
   */
  getUsersByStatus(status) {
    const users = this.getAllUsers();
    return users.filter(user => user.status === status);
  }

  // Settlement Management Methods

  // Excel-based settlement methods removed - now using MySQL only

  // All Excel-based settlement methods removed - now using MySQL only

  // Transaction History Methods - Excel methods removed, will be migrated to MySQL later

  // Transaction methods removed - will be migrated to MySQL later

  // ==================== CARRIERS CRUD OPERATIONS (MySQL) ====================

  /**
   * Get all carriers from MySQL
   * @returns {Promise<Array>} Array of carrier data
   */
  async getAllCarriers() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        `SELECT 
          c.*,
          s.store_name,
          s.account_code as store_account_code
        FROM carriers c
        LEFT JOIN store_info s ON c.account_code = s.account_code
        ORDER BY c.priority ASC`
      );
      return rows;
    } catch (error) {
      console.error('Error getting all carriers:', error);
      throw new Error('Failed to get carriers from database');
    }
  }

  /**
   * Get carriers by account_code (store-specific)
   * @param {string} accountCode - The account code to filter by
   * @returns {Promise<Array>} Array of carriers for the specified store
   */
  async getCarriersByAccountCode(accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!accountCode) {
      throw new Error('account_code is required');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        `SELECT 
          c.*,
          s.store_name,
          s.account_code as store_account_code
        FROM carriers c
        LEFT JOIN store_info s ON c.account_code = s.account_code
        WHERE c.account_code = ?
        ORDER BY c.priority ASC`,
        [accountCode]
      );
      return rows;
    } catch (error) {
      console.error('Error getting carriers by account_code:', error);
      throw new Error('Failed to get carriers from database');
    }
  }

  /**
   * Get a utility parameter value from the database
   * @param {string} parameter - The parameter name
   * @returns {Promise<string|null>} The parameter value or null if not found
   */
  async getUtilityParameter(parameter) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT value FROM utility WHERE parameter = ?',
        [parameter]
      );
      return rows.length > 0 ? rows[0].value : null;
    } catch (error) {
      console.error('Error getting utility parameter:', error);
      throw new Error(`Failed to get utility parameter: ${parameter}`);
    }
  }

  /**
   * Update or insert a utility parameter
   * @param {string} parameter - The parameter name
   * @param {string} value - The parameter value
   * @param {string} modifiedBy - Who is modifying the parameter (default: 'system')
   * @returns {Promise<boolean>} True if successful
   */
  async updateUtilityParameter(parameter, value, modifiedBy = 'system') {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      await this.mysqlConnection.execute(
        `INSERT INTO utility (parameter, value, created_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = ?, created_by = ?, modified_at = CURRENT_TIMESTAMP`,
        [parameter, value, modifiedBy, value, modifiedBy]
      );
      return true;
    } catch (error) {
      console.error('Error updating utility parameter:', error);
      throw new Error(`Failed to update utility parameter: ${parameter}`);
    }
  }

  /**
   * Get all utility parameters from the database
   * @returns {Promise<Array>} Array of all parameters
   */
  async getAllUtilityParameters() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM utility ORDER BY parameter ASC'
      );
      return rows;
    } catch (error) {
      console.error('Error getting all utility parameters:', error);
      throw new Error('Failed to get all utility parameters from database');
    }
  }

  /**
   * Get all shipping partners from utility table
   * @returns {Promise<Array>} Array of shipping partner names
   */
  async getShippingPartners() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT value FROM utility WHERE parameter = ? ORDER BY value ASC',
        ['shipping_partner']
      );
      return rows.map(row => row.value);
    } catch (error) {
      console.error('Error getting shipping partners:', error);
      throw new Error('Failed to get shipping partners from database');
    }
  }

  /**
   * Get carrier by carrier_id
   * @param {string} carrierId - Carrier ID
   * @returns {Promise<Object|null>} Carrier object or null if not found
   */
  async getCarrierById(carrierId, accountCode = null) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      let query, params;
      if (accountCode) {
        // Check by both carrier_id and account_code (store-specific)
        query = 'SELECT * FROM carriers WHERE carrier_id = ? AND account_code = ?';
        params = [carrierId, accountCode];
      } else {
        // Legacy: check by carrier_id only (for backward compatibility)
        query = 'SELECT * FROM carriers WHERE carrier_id = ?';
        params = [carrierId];
      }
      
      const [rows] = await this.mysqlConnection.execute(query, params);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting carrier by ID:', error);
      throw new Error('Failed to get carrier from database');
    }
  }

  /**
   * Create new carrier
   * @param {Object} carrierData - Carrier data
   * @returns {Promise<Object>} Created carrier object
   */
  async createCarrier(carrierData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const { carrier_id, carrier_name, status, weight_in_kg, priority, account_code } = carrierData;
      
      if (!account_code) {
        throw new Error('account_code is required for creating carrier');
      }
      
      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO carriers (carrier_id, carrier_name, status, weight_in_kg, priority, account_code) VALUES (?, ?, ?, ?, ?, ?)',
        [carrier_id, carrier_name, status || 'Active', weight_in_kg || null, priority, account_code]
      );

      return {
        id: result.insertId,
        carrier_id,
        carrier_name,
        status: status || 'Active',
        weight_in_kg,
        priority
      };
    } catch (error) {
      console.error('Error creating carrier:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('Carrier with this ID already exists');
      }
      throw new Error('Failed to create carrier in database');
    }
  }

  /**
   * Update carrier
   * @param {string} carrierId - Carrier ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object|null>} Updated carrier object or null if not found
   */
  async updateCarrier(carrierId, updateData, accountCode = null) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const fields = [];
      const values = [];

      if (updateData.carrier_name !== undefined) {
        fields.push('carrier_name = ?');
        values.push(updateData.carrier_name);
      }
      if (updateData.status !== undefined) {
        fields.push('status = ?');
        values.push(updateData.status);
      }
      if (updateData.weight_in_kg !== undefined) {
        fields.push('weight_in_kg = ?');
        values.push(updateData.weight_in_kg);
      }
      if (updateData.priority !== undefined) {
        fields.push('priority = ?');
        values.push(updateData.priority);
      }
      if (updateData.account_code !== undefined) {
        fields.push('account_code = ?');
        values.push(updateData.account_code);
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      // Build WHERE clause - use account_code if provided
      let whereClause = 'carrier_id = ?';
      values.push(carrierId);
      
      if (accountCode) {
        whereClause += ' AND account_code = ?';
        values.push(accountCode);
      } else if (updateData.account_code) {
        // Use account_code from updateData if not provided as parameter
        whereClause += ' AND account_code = ?';
        values.push(updateData.account_code);
      }

      const [result] = await this.mysqlConnection.execute(
        `UPDATE carriers SET ${fields.join(', ')} WHERE ${whereClause}`,
        values
      );

      if (result.affectedRows === 0) {
        return null;
      }

      // Use accountCode from parameter or updateData
      const finalAccountCode = accountCode || updateData.account_code || null;
      return await this.getCarrierById(carrierId, finalAccountCode);
    } catch (error) {
      console.error('Error updating carrier:', error);
      throw new Error('Failed to update carrier in database');
    }
  }

  /**
   * Swap carrier priorities atomically using a transaction
   * @param {string} carrierId1 - First carrier ID
   * @param {string} carrierId2 - Second carrier ID
   * @param {number} priority1 - First carrier's priority
   * @param {number} priority2 - Second carrier's priority
   * @returns {Promise<void>}
   */
  async swapCarrierPriorities(carrierId1, carrierId2, priority1, priority2) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      await this.mysqlConnection.beginTransaction();

      // Update both carriers in a single transaction
      await this.mysqlConnection.execute(
        'UPDATE carriers SET priority = ? WHERE carrier_id = ?',
        [priority2, carrierId1]
      );

      await this.mysqlConnection.execute(
        'UPDATE carriers SET priority = ? WHERE carrier_id = ?',
        [priority1, carrierId2]
      );

      await this.mysqlConnection.commit();
    } catch (error) {
      await this.mysqlConnection.rollback();
      console.error('Error swapping carrier priorities:', error);
      throw new Error('Failed to swap carrier priorities');
    }
  }

  /**
   * Reorder carrier priorities sequentially (1, 2, 3, ...)
   * @param {Array} carriers - Array of carriers in the desired order
   * @returns {Promise<void>}
   */
  async reorderCarrierPriorities(carriers, accountCode = null) {
    if (!this.mysqlConnection && !this.mysqlPool) {
      throw new Error('MySQL connection not available');
    }

    // Get a connection from the pool for transaction support
    const db = this.mysqlPool || this.mysqlConnection;
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Update priorities sequentially starting from 1
      for (let i = 0; i < carriers.length; i++) {
        const newPriority = i + 1;
        const carrier = carriers[i];
        const carrierAccountCode = accountCode || carrier.account_code;
        
        if (!carrierAccountCode) {
          throw new Error('account_code is required for reordering priorities');
        }

        // Update with both carrier_id and account_code to ensure store-specific update
        await connection.execute(
          'UPDATE carriers SET priority = ? WHERE carrier_id = ? AND account_code = ?',
          [newPriority, carrier.carrier_id, carrierAccountCode]
        );
      }

      await connection.commit();
      console.log(`✅ Reordered ${carriers.length} carrier priorities sequentially${accountCode ? ` for store ${accountCode}` : ''}`);
    } catch (error) {
      await connection.rollback();
      console.error('Error reordering carrier priorities:', error);
      throw new Error('Failed to reorder carrier priorities');
    } finally {
      connection.release();
    }
  }

  /**
   * Delete carrier
   * @param {string} carrierId - Carrier ID
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteCarrier(carrierId, accountCode = null) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      let query, params;
      if (accountCode) {
        // Delete by both carrier_id and account_code (store-specific)
        query = 'DELETE FROM carriers WHERE carrier_id = ? AND account_code = ?';
        params = [carrierId, accountCode];
      } else {
        // Legacy: delete by carrier_id only (for backward compatibility)
        query = 'DELETE FROM carriers WHERE carrier_id = ?';
        params = [carrierId];
      }

      const [result] = await this.mysqlConnection.execute(query, params);

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting carrier:', error);
      throw new Error('Failed to delete carrier from database');
    }
  }

  /**
   * Bulk insert/update carriers (for sync operations)
   * @param {Array} carriers - Array of carrier data
   * @returns {Promise<Object>} Result with counts
   */
  async bulkUpsertCarriers(carriers) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      let inserted = 0;
      let updated = 0;

      for (const carrier of carriers) {
        // Check by both carrier_id and account_code (store-specific)
        const accountCode = carrier.account_code || null;
        const existing = await this.getCarrierById(carrier.carrier_id, accountCode);
        
        if (existing) {
          await this.updateCarrier(carrier.carrier_id, carrier, accountCode);
          updated++;
        } else {
          await this.createCarrier(carrier);
          inserted++;
        }
      }

      return {
        success: true,
        inserted,
        updated,
        total: carriers.length
      };
    } catch (error) {
      console.error('Error bulk upserting carriers:', error);
      throw new Error('Failed to bulk upsert carriers');
    }
  }

  /**
   * Get carriers by status
   * @param {string} status - Carrier status
   * @returns {Promise<Array>} Array of carriers with specified status
   */
  async getCarriersByStatus(status) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM carriers WHERE status = ? ORDER BY priority ASC',
        [status]
      );
      return rows;
    } catch (error) {
      console.error('Error getting carriers by status:', error);
      throw new Error('Failed to get carriers by status');
    }
  }

  // ==================== PRODUCTS CRUD OPERATIONS (MySQL) ====================

  /**
   * Get all products from MySQL
   * @returns {Promise<Array>} Array of all products
   */
  async getAllProducts() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM products ORDER BY name ASC'
      );
      return rows;
    } catch (error) {
      console.error('Error getting all products:', error);
      throw new Error('Failed to get products from database');
    }
  }

  /**
   * Get product by ID (Shopify product ID)
   * @param {string} id - Product ID (Shopify ID)
   * @returns {Promise<Object|null>} Product object or null if not found
   */
  async getProductById(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM products WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting product by ID:', error);
      throw new Error('Failed to get product from database');
    }
  }

  /**
   * Create new product
   * @param {Object} productData - Product data
   * @returns {Promise<Object>} Created product object
   */
  async createProduct(productData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const { id, name, image, altText, totalImages, sku_id, account_code } = productData;
      
      if (!account_code) {
        throw new Error('account_code is required for creating product');
      }
      
      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO products (id, name, image, altText, totalImages, sku_id, account_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, name, image || null, altText || null, totalImages || 0, sku_id || null, account_code]
      );

      return {
        id,
        name,
        image,
        altText,
        totalImages: totalImages || 0
      };
    } catch (error) {
      console.error('Error creating product:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('Product with this ID already exists');
      }
      throw new Error('Failed to create product in database');
    }
  }

  /**
   * Update product
   * @param {string} id - Product ID (Shopify ID)
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object|null>} Updated product object or null if not found
   */
  async updateProduct(id, updateData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const fields = [];
      const values = [];

      if (updateData.name !== undefined) {
        fields.push('name = ?');
        values.push(updateData.name);
      }
      if (updateData.image !== undefined) {
        fields.push('image = ?');
        values.push(updateData.image);
      }
      if (updateData.altText !== undefined) {
        fields.push('altText = ?');
        values.push(updateData.altText);
      }
      if (updateData.totalImages !== undefined) {
        fields.push('totalImages = ?');
        values.push(updateData.totalImages);
      }
      if (updateData.sku_id !== undefined) {
        fields.push('sku_id = ?');
        values.push(updateData.sku_id);
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      values.push(id);

      const [result] = await this.mysqlConnection.execute(
        `UPDATE products SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return await this.getProductById(id);
    } catch (error) {
      console.error('Error updating product:', error);
      throw new Error('Failed to update product in database');
    }
  }

  /**
   * Delete product
   * @param {string} id - Product ID (Shopify ID)
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteProduct(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [result] = await this.mysqlConnection.execute(
        'DELETE FROM products WHERE id = ?',
        [id]
      );

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting product:', error);
      throw new Error('Failed to delete product from database');
    }
  }

  /**
   * Bulk insert/update products (for sync operations)
   * @param {Array} products - Array of product data
   * @returns {Promise<Object>} Result with counts
   */
  async bulkUpsertProducts(products) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      let inserted = 0;
      let updated = 0;

      for (const product of products) {
        const existing = await this.getProductById(product.id);
        
        if (existing) {
          await this.updateProduct(product.id, product);
          updated++;
        } else {
          await this.createProduct(product);
          inserted++;
        }
      }

      return {
        success: true,
        inserted,
        updated,
        total: products.length
      };
    } catch (error) {
      console.error('Error bulk upserting products:', error);
      throw new Error('Failed to bulk upsert products');
    }
  }

  /**
   * Search products by name
   * @param {string} searchTerm - Search term
   * @returns {Promise<Array>} Array of matching products
   */
  async searchProductsByName(searchTerm) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM products WHERE name LIKE ? ORDER BY name ASC',
        [`%${searchTerm}%`]
      );
      return rows;
    } catch (error) {
      console.error('Error searching products by name:', error);
      throw new Error('Failed to search products');
    }
  }

  // ==================== USERS CRUD OPERATIONS (MySQL) ====================

  /**
   * Get all users from MySQL
   * @returns {Promise<Array>} Array of all users
   */
  async getAllUsers() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users ORDER BY name ASC'
      );
      return rows;
    } catch (error) {
      console.error('Error getting all users:', error);
      throw new Error('Failed to get users from database');
    }
  }

  /**
   * Get vendor statistics (counts only, optimized for performance)
   * @returns {Promise<Object>} Object with vendor counts
   */
  async getVendorStats() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Execute both queries in parallel for better performance
      const [totalResult, activeResult] = await Promise.all([
        this.mysqlConnection.execute(
          "SELECT COUNT(*) as count FROM users WHERE role = 'vendor'"
        ),
        this.mysqlConnection.execute(
          "SELECT COUNT(*) as count FROM users WHERE role = 'vendor' AND status = 'active'"
        )
      ]);

      return {
        totalVendors: parseInt(totalResult[0][0]?.count || 0),
        activeVendors: parseInt(activeResult[0][0]?.count || 0)
      };
    } catch (error) {
      console.error('Error getting vendor stats:', error);
      throw new Error('Failed to get vendor stats from database');
    }
  }

  /**
   * Get user by ID
   * @param {string} id - User ID
   * @returns {Promise<Object|null>} User object or null if not found
   */
  async getUserById(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw new Error('Failed to get user from database');
    }
  }

  /**
   * Get user by email
   * @param {string} email - User email
   * @returns {Promise<Object|null>} User object or null if not found
   */
  async getUserByEmail(email) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users WHERE email = ?',
        [email]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting user by email:', error);
      throw new Error('Failed to get user from database');
    }
  }

  /**
   * Get user by phone
   * @param {string} phone - User phone number
   * @returns {Promise<Object|null>} User object or null if not found
   */
  async getUserByPhone(phone) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users WHERE phone = ? OR contactNumber = ?',
        [phone, phone]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting user by phone:', error);
      throw new Error('Failed to get user from database');
    }
  }

  /**
   * Get user by warehouse ID
   * @param {string} warehouseId - Warehouse ID
   * @returns {Promise<Object|null>} User object or null if not found
   */
  async getUserByWarehouseId(warehouseId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users WHERE warehouseId = ?',
        [warehouseId]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting user by warehouse ID:', error);
      throw new Error('Failed to get user from database');
    }
  }

  /**
   * Get user by token
   * @param {string} token - User token
   * @returns {Promise<Object|null>} User object or null if not found
   */
  async getUserByToken(token) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users WHERE token = ?',
        [token]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting user by token:', error);
      throw new Error('Failed to get user from database');
    }
  }

  /**
   * Create new user
   * @param {Object} userData - User data
   * @returns {Promise<Object>} Created user object
   */
  async createUser(userData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const { 
        id, name, email, phone, password, role, status, 
        token, active_session, contactNumber, warehouseId, 
        address, city, pincode 
      } = userData;
      
      // Generate ID if not provided
      const userId = id || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO users (id, name, email, phone, password, role, status, token, active_session, contactNumber, warehouseId, address, city, pincode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, name, email, phone || null, password || null, role, status || 'active', token || null, active_session || null, contactNumber || null, warehouseId || null, address || null, city || null, pincode || null]
      );

      return {
        id: userId,
        name,
        email,
        phone,
        role,
        status: status || 'active',
        token,
        active_session,
        contactNumber,
        warehouseId,
        address,
        city,
        pincode
      };
    } catch (error) {
      console.error('Error creating user:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('User with this email already exists');
      }
      throw new Error('Failed to create user in database');
    }
  }

  /**
   * Update user
   * @param {string} id - User ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object|null>} Updated user object or null if not found
   */
  async updateUser(id, updateData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const fields = [];
      const values = [];

      if (updateData.name !== undefined) {
        fields.push('name = ?');
        values.push(updateData.name);
      }
      if (updateData.email !== undefined) {
        fields.push('email = ?');
        values.push(updateData.email);
      }
      if (updateData.phone !== undefined) {
        fields.push('phone = ?');
        values.push(updateData.phone);
      }
      if (updateData.password !== undefined) {
        fields.push('password = ?');
        values.push(updateData.password);
      }
      if (updateData.role !== undefined) {
        fields.push('role = ?');
        values.push(updateData.role);
      }
      if (updateData.status !== undefined) {
        fields.push('status = ?');
        values.push(updateData.status);
      }
      if (updateData.token !== undefined) {
        fields.push('token = ?');
        values.push(updateData.token);
      }
      if (updateData.active_session !== undefined) {
        fields.push('active_session = ?');
        values.push(updateData.active_session);
      }
      if (updateData.contactNumber !== undefined) {
        fields.push('contactNumber = ?');
        values.push(updateData.contactNumber);
      }
      if (updateData.warehouseId !== undefined) {
        fields.push('warehouseId = ?');
        values.push(updateData.warehouseId);
      }
      if (updateData.address !== undefined) {
        fields.push('address = ?');
        values.push(updateData.address);
      }
      if (updateData.city !== undefined) {
        fields.push('city = ?');
        values.push(updateData.city);
      }
      if (updateData.pincode !== undefined) {
        fields.push('pincode = ?');
        values.push(updateData.pincode);
      }
      if (updateData.lastLogin !== undefined) {
        fields.push('lastLogin = ?');
        values.push(updateData.lastLogin);
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      values.push(id);

      const [result] = await this.mysqlConnection.execute(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return await this.getUserById(id);
    } catch (error) {
      console.error('Error updating user:', error);
      throw new Error('Failed to update user in database');
    }
  }

  /**
   * Delete user
   * @param {string} id - User ID
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteUser(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [result] = await this.mysqlConnection.execute(
        'DELETE FROM users WHERE id = ?',
        [id]
      );

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw new Error('Failed to delete user from database');
    }
  }

  /**
   * Get users by role
   * @param {string} role - User role
   * @returns {Promise<Array>} Array of users with specified role
   */
  async getUsersByRole(role) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users WHERE role = ? ORDER BY name ASC',
        [role]
      );
      return rows;
    } catch (error) {
      console.error('Error getting users by role:', error);
      throw new Error('Failed to get users by role');
    }
  }

  /**
   * Get users by status
   * @param {string} status - User status
   * @returns {Promise<Array>} Array of users with specified status
   */
  async getUsersByStatus(status) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users WHERE status = ? ORDER BY name ASC',
        [status]
      );
      return rows;
    } catch (error) {
      console.error('Error getting users by status:', error);
      throw new Error('Failed to get users by status');
    }
  }

  /**
   * Search users by name or email
   * @param {string} searchTerm - Search term
   * @returns {Promise<Array>} Array of matching users
   */
  async searchUsers(searchTerm) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name ASC',
        [`%${searchTerm}%`, `%${searchTerm}%`]
      );
      return rows;
    } catch (error) {
      console.error('Error searching users:', error);
      throw new Error('Failed to search users');
    }
  }

  // ==================== SETTLEMENTS CRUD OPERATIONS (MySQL) ====================

  /**
   * Get all settlements from MySQL
   * @returns {Promise<Array>} Array of all settlements
   */
  async getAllSettlements() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM settlements ORDER BY createdAt DESC'
      );
      return rows;
    } catch (error) {
      console.error('Error getting all settlements:', error);
      throw new Error('Failed to get settlements from database');
    }
  }

  /**
   * Get settlement by ID
   * @param {string} id - Settlement ID
   * @returns {Promise<Object|null>} Settlement object or null if not found
   */
  async getSettlementById(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM settlements WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting settlement by ID:', error);
      throw new Error('Failed to get settlement from database');
    }
  }

  /**
   * Get settlements by vendor ID
   * @param {string} vendorId - Vendor ID
   * @returns {Promise<Array>} Array of settlements for the vendor
   */
  async getSettlementsByVendor(vendorId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM settlements WHERE vendorId = ? ORDER BY createdAt DESC',
        [vendorId]
      );
      return rows;
    } catch (error) {
      console.error('Error getting settlements by vendor:', error);
      throw new Error('Failed to get settlements by vendor');
    }
  }

  /**
   * Get settlements by status
   * @param {string} status - Settlement status
   * @returns {Promise<Array>} Array of settlements with specified status
   */
  async getSettlementsByStatus(status) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM settlements WHERE status = ? ORDER BY createdAt DESC',
        [status]
      );
      return rows;
    } catch (error) {
      console.error('Error getting settlements by status:', error);
      throw new Error('Failed to get settlements by status');
    }
  }

  /**
   * Create new settlement
   * @param {Object} settlementData - Settlement data
   * @returns {Promise<Object>} Created settlement object
   */
  async createSettlement(settlementData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const { 
        id, vendorId, vendorName, amount, upiId, orderIds, numberOfOrders, 
        currency, status, paymentStatus, amountPaid, transactionId, 
        paymentProofPath, approvedBy, approvedAt, rejectionReason, 
        rejectedBy, rejectedAt 
      } = settlementData;
      
      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO settlements (id, vendorId, vendorName, amount, upiId, orderIds, numberOfOrders, currency, status, paymentStatus, amountPaid, transactionId, paymentProofPath, approvedBy, approvedAt, rejectionReason, rejectedBy, rejectedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id || `settlement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          vendorId || null,
          vendorName || null,
          amount || null,
          upiId || null,
          orderIds || null,
          numberOfOrders || null,
          currency || 'INR',
          status || 'pending',
          paymentStatus || 'pending',
          amountPaid || 0,
          transactionId || null,
          paymentProofPath || null,
          approvedBy || null,
          approvedAt || null,
          rejectionReason || null,
          rejectedBy || null,
          rejectedAt || null
        ]
      );

      return await this.getSettlementById(id || `settlement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    } catch (error) {
      console.error('Error creating settlement:', error);
      throw new Error('Failed to create settlement in database');
    }
  }

  /**
   * Update settlement
   * @param {string} id - Settlement ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object|null>} Updated settlement object or null if not found
   */
  async updateSettlement(id, updateData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const fields = [];
      const values = [];

      if (updateData.vendorId !== undefined) {
        fields.push('vendorId = ?');
        values.push(updateData.vendorId);
      }
      if (updateData.vendorName !== undefined) {
        fields.push('vendorName = ?');
        values.push(updateData.vendorName);
      }
      if (updateData.amount !== undefined) {
        fields.push('amount = ?');
        values.push(updateData.amount);
      }
      if (updateData.upiId !== undefined) {
        fields.push('upiId = ?');
        values.push(updateData.upiId);
      }
      if (updateData.orderIds !== undefined) {
        fields.push('orderIds = ?');
        values.push(updateData.orderIds);
      }
      if (updateData.numberOfOrders !== undefined) {
        fields.push('numberOfOrders = ?');
        values.push(updateData.numberOfOrders);
      }
      if (updateData.currency !== undefined) {
        fields.push('currency = ?');
        values.push(updateData.currency);
      }
      if (updateData.status !== undefined) {
        fields.push('status = ?');
        values.push(updateData.status);
      }
      if (updateData.paymentStatus !== undefined) {
        fields.push('paymentStatus = ?');
        values.push(updateData.paymentStatus);
      }
      if (updateData.amountPaid !== undefined) {
        fields.push('amountPaid = ?');
        values.push(updateData.amountPaid);
      }
      if (updateData.transactionId !== undefined) {
        fields.push('transactionId = ?');
        values.push(updateData.transactionId);
      }
      if (updateData.paymentProofPath !== undefined) {
        fields.push('paymentProofPath = ?');
        values.push(updateData.paymentProofPath);
      }
      if (updateData.approvedBy !== undefined) {
        fields.push('approvedBy = ?');
        values.push(updateData.approvedBy);
      }
      if (updateData.approvedAt !== undefined) {
        fields.push('approvedAt = ?');
        values.push(updateData.approvedAt);
      }
      if (updateData.rejectionReason !== undefined) {
        fields.push('rejectionReason = ?');
        values.push(updateData.rejectionReason);
      }
      if (updateData.rejectedBy !== undefined) {
        fields.push('rejectedBy = ?');
        values.push(updateData.rejectedBy);
      }
      if (updateData.rejectedAt !== undefined) {
        fields.push('rejectedAt = ?');
        values.push(updateData.rejectedAt);
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      values.push(id);

      const [result] = await this.mysqlConnection.execute(
        `UPDATE settlements SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return await this.getSettlementById(id);
    } catch (error) {
      console.error('Error updating settlement:', error);
      throw new Error('Failed to update settlement in database');
    }
  }

  /**
   * Delete settlement
   * @param {string} id - Settlement ID
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteSettlement(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [result] = await this.mysqlConnection.execute(
        'DELETE FROM settlements WHERE id = ?',
        [id]
      );

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting settlement:', error);
      throw new Error('Failed to delete settlement from database');
    }
  }

  /**
   * Search settlements by vendor name or UPI ID
   * @param {string} searchTerm - Search term
   * @returns {Promise<Array>} Array of matching settlements
   */
  async searchSettlements(searchTerm) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM settlements WHERE vendorName LIKE ? OR upiId LIKE ? ORDER BY createdAt DESC',
        [`%${searchTerm}%`, `%${searchTerm}%`]
      );
      return rows;
    } catch (error) {
      console.error('Error searching settlements:', error);
      throw new Error('Failed to search settlements');
    }
  }

  // ==================== TRANSACTIONS CRUD OPERATIONS (MySQL) ====================

  /**
   * Get all transactions from MySQL
   * @returns {Array} Array of all transactions
   */
  async getAllTransactions() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM transactions ORDER BY createdAt DESC'
      );
      return rows;
    } catch (error) {
      console.error('Error getting all transactions:', error);
      throw new Error('Failed to get all transactions');
    }
  }

  /**
   * Get transaction by ID from MySQL
   * @param {string} id - Transaction ID
   * @returns {Object|null} Transaction object or null if not found
   */
  async getTransactionById(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM transactions WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting transaction by ID:', error);
      throw new Error('Failed to get transaction by ID');
    }
  }

  /**
   * Get transactions by vendor ID from MySQL
   * @param {string} vendorId - Vendor ID
   * @returns {Array} Array of transactions for the vendor
   */
  async getTransactionsByVendor(vendorId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM transactions WHERE vendor_id = ? ORDER BY createdAt DESC',
        [vendorId]
      );
      return rows;
    } catch (error) {
      console.error('Error getting transactions by vendor:', error);
      throw new Error('Failed to get transactions by vendor');
    }
  }

  /**
   * Get transactions by type from MySQL
   * @param {string} type - Transaction type
   * @returns {Array} Array of transactions with specified type
   */
  async getTransactionsByType(type) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM transactions WHERE type = ? ORDER BY createdAt DESC',
        [type]
      );
      return rows;
    } catch (error) {
      console.error('Error getting transactions by type:', error);
      throw new Error('Failed to get transactions by type');
    }
  }

  /**
   * Create new transaction in MySQL
   * @param {Object} transactionData - Transaction data
   * @returns {Object} Created transaction object
   */
  async createTransaction(transactionData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const { id, vendor_id, amount, type, description } = transactionData;
      
      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO transactions (id, vendor_id, amount, type, description) VALUES (?, ?, ?, ?, ?)',
        [
          id || `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          vendor_id,
          amount,
          type,
          description
        ]
      );

      // Return the created transaction
      const createdTransaction = await this.getTransactionById(id || `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
      return createdTransaction;
    } catch (error) {
      console.error('Error creating transaction:', error);
      throw new Error('Failed to create transaction');
    }
  }

  /**
   * Update transaction in MySQL
   * @param {string} id - Transaction ID
   * @param {Object} updateData - Data to update
   * @returns {Object|null} Updated transaction object or null if not found
   */
  async updateTransaction(id, updateData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const fields = [];
      const values = [];

      if (updateData.vendor_id !== undefined) {
        fields.push('vendor_id = ?');
        values.push(updateData.vendor_id);
      }
      if (updateData.amount !== undefined) {
        fields.push('amount = ?');
        values.push(updateData.amount);
      }
      if (updateData.type !== undefined) {
        fields.push('type = ?');
        values.push(updateData.type);
      }
      if (updateData.description !== undefined) {
        fields.push('description = ?');
        values.push(updateData.description);
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      values.push(id);

      const [result] = await this.mysqlConnection.execute(
        `UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return await this.getTransactionById(id);
    } catch (error) {
      console.error('Error updating transaction:', error);
      throw new Error('Failed to update transaction');
    }
  }

  /**
   * Delete transaction from MySQL
   * @param {string} id - Transaction ID
   * @returns {boolean} True if deleted, false if not found
   */
  async deleteTransaction(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [result] = await this.mysqlConnection.execute(
        'DELETE FROM transactions WHERE id = ?',
        [id]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting transaction:', error);
      throw new Error('Failed to delete transaction');
    }
  }

  /**
   * Search transactions in MySQL
   * @param {string} searchTerm - Search term
   * @returns {Array} Array of matching transactions
   */
  async searchTransactions(searchTerm) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM transactions WHERE description LIKE ? OR type LIKE ? ORDER BY createdAt DESC',
        [`%${searchTerm}%`, `%${searchTerm}%`]
      );
      return rows;
    } catch (error) {
      console.error('Error searching transactions:', error);
      throw new Error('Failed to search transactions');
    }
  }

  // ==================== ORDERS CRUD METHODS ====================

  /**
   * Create a new order in MySQL
   * @param {Object} orderData - Order data
   * @returns {Object} Created order
   */
  async createOrder(orderData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!orderData.account_code) {
      throw new Error('account_code is required for creating order');
    }

    try {
      // Extract size from product_code
      const extractedSize = this.extractSizeFromSku(orderData.product_code);

      // Use INSERT ... ON DUPLICATE KEY UPDATE for orders table
      await this.mysqlConnection.execute(
        `INSERT INTO orders (
          id, unique_id, order_id, customer_name, order_date,
          product_name, product_code, size, quantity, selling_price, order_total, payment_type,
          is_partial_paid, prepaid_amount, order_total_ratio, order_total_split, collectable_amount,
          pincode, is_in_new_order, account_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          order_date = VALUES(order_date),
          product_name = VALUES(product_name),
          product_code = VALUES(product_code),
          size = VALUES(size),
          quantity = VALUES(quantity),
          selling_price = VALUES(selling_price),
          order_total = VALUES(order_total),
          payment_type = VALUES(payment_type),
          is_partial_paid = VALUES(is_partial_paid),
          prepaid_amount = VALUES(prepaid_amount),
          order_total_ratio = VALUES(order_total_ratio),
          order_total_split = VALUES(order_total_split),
          collectable_amount = VALUES(collectable_amount),
          pincode = VALUES(pincode),
          is_in_new_order = VALUES(is_in_new_order),
          account_code = VALUES(account_code)`,
        [
          orderData.id || null,
          orderData.unique_id || null,
          orderData.order_id || null,
          orderData.customer_name || null,
          orderData.order_date || null,
          orderData.product_name || null,
          orderData.product_code || null,
          extractedSize || null,
          orderData.quantity || null,
          orderData.selling_price || null,
          orderData.order_total || null,
          orderData.payment_type || null,
          orderData.is_partial_paid !== undefined ? orderData.is_partial_paid : false,
          orderData.prepaid_amount || null,
          orderData.order_total_ratio || null,
          orderData.order_total_split || null,
          orderData.collectable_amount || null,
          orderData.pincode || null,
          orderData.is_in_new_order !== undefined ? orderData.is_in_new_order : true,
          orderData.account_code
        ]
      );

      // Use INSERT ... ON DUPLICATE KEY UPDATE for claims table
      await this.mysqlConnection.execute(
        `INSERT INTO claims (
          order_unique_id, order_id, status, claimed_by, claimed_at, last_claimed_by, 
          last_claimed_at, clone_status, cloned_order_id, is_cloned_row, label_downloaded, account_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          order_id = VALUES(order_id),
          account_code = VALUES(account_code)`,
        [
          orderData.unique_id || null,
          orderData.order_id || null,
          orderData.status || 'unclaimed',
          orderData.claimed_by || null,
          orderData.claimed_at || null,
          orderData.last_claimed_by || null,
          orderData.last_claimed_at || null,
          orderData.clone_status || 'not_cloned',
          orderData.cloned_order_id || null,
          orderData.is_cloned_row || false,
          orderData.label_downloaded || false,
          orderData.account_code
        ]
      );

      // Use INSERT ... ON DUPLICATE KEY UPDATE for labels table
      await this.mysqlConnection.execute(
        `INSERT INTO labels (
          order_id, handover_at, priority_carrier, account_code
        ) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          handover_at = VALUES(handover_at),
          priority_carrier = VALUES(priority_carrier),
          account_code = VALUES(account_code)`,
        [
          orderData.order_id || null,
          orderData.handover_at || null,
          orderData.priority_carrier || null,
          orderData.account_code
        ]
      );

      return await this.getOrderByUniqueId(orderData.unique_id);
    } catch (error) {
      console.error('Error creating order:', error);
      // Include the actual error message for better debugging
      const errorMessage = error.message || 'Unknown error';
      throw new Error(`Failed to create order: ${errorMessage}`);
    }
  }

  /**
   * Remove size information from product name for matching
   * @param {string} productName - Product name with size
   * @returns {string} Product name without size
   */
  removeSizeFromProductName(productName) {
    if (!productName) return '';
    
    let cleanName = productName.trim();
    
    // Check if it's a kids product
    if (cleanName.toLowerCase().includes('kids')) {
      // For kids products, only remove numeric size patterns like 24-26, 16-18, 20-22
      cleanName = cleanName.replace(/ - [0-9]+-[0-9]+$/i, '');
    } else {
      // For regular products, remove standard size patterns
      const sizePatterns = [
        / - (XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/i,
        / - (XXXL|XXL)$/i,
        / - (Small|Medium|Large|Extra Large)$/i,
        / - (\d{4}-\d{4})$/i, // Year patterns like 2025-26
        /^(XS|S|M|L|XL|2XL|3XL|4XL|5XL) - /i,
        /^(Small|Medium|Large|Extra Large) - /i,
        / - (XS|S|M|L|XL|2XL|3XL|4XL|5XL)(?= - |$)/gi,
        / - (Small|Medium|Large|Extra Large)(?= - |$)/gi,
      ];
      
      for (const pattern of sizePatterns) {
        cleanName = cleanName.replace(pattern, '');
      }
    }
    
    // Clean up any double spaces or trailing dashes
    cleanName = cleanName.replace(/\s*-\s*$/, ''); // Remove trailing dash
    cleanName = cleanName.replace(/\s+/g, ' '); // Replace multiple spaces with single space
    cleanName = cleanName.trim();
    
    return cleanName;
  }

  /**
   * Remove size information from SKU for matching
   * @param {string} skuId - SKU with size
   * @returns {string} SKU without size
   */
  cleanSkuId(skuId) {
    if (!skuId) return skuId;
    
    // Remove size information from the end
    let cleanedSku = skuId
      // Remove size codes (S, M, L, XL, etc.) at the end
      .replace(/[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$/i, '')
      // Remove age ranges (24-26, 25-26, etc.) at the end
      .replace(/[-_][0-9]+-[0-9]+$/, '')
      // Remove single numbers at the end (size numbers like 32, 34, etc.)
      .replace(/[-_][0-9]+$/, '')
      // Clean up any double dashes or underscores
      .replace(/[-_]{2,}/g, '-')
      // Remove trailing dashes/underscores
      .replace(/[-_]+$/, '')
      .trim();
      
    return cleanedSku;
  }

  /**
   * Extract size information from SKU ID
   * @param {string} skuId - SKU with size
   * @returns {string} Extracted size or null if no size found
   */
  extractSizeFromSku(skuId) {
    if (!skuId) return null;
    
    // Try to extract size codes (S, M, L, XL, etc.) at the end
    const sizeMatch = skuId.match(/[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$/i);
    if (sizeMatch) {
      return sizeMatch[1].toUpperCase();
    }
    
    // Try to extract age ranges (24-26, 25-26, etc.) at the end
    const ageRangeMatch = skuId.match(/[-_]([0-9]+-[0-9]+)$/);
    if (ageRangeMatch) {
      return ageRangeMatch[1];
    }
    
    // Try to extract single numbers at the end (size numbers like 32, 34, etc.)
    const numberMatch = skuId.match(/[-_]([0-9]+)$/);
    if (numberMatch) {
      return numberMatch[1];
    }
    
    return null;
  }

  /**
   * Get order by unique_id from MySQL
   * @param {string} unique_id - Order unique ID
   * @returns {Object|null} Order data or null if not found
   */
  async getOrderByUniqueId(unique_id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        WHERE o.unique_id = ?
      `, [unique_id]);
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting order by unique_id:', error);
      throw new Error('Failed to get order from database');
    }
  }

  /**
   * Get all orders for a specific order_id from MySQL
   * @param {string} order_id - Order ID
   * @returns {Array} Array of orders
   */
  async getOrdersByOrderId(order_id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        WHERE o.order_id = ? 
        ORDER BY o.product_name
      `, [order_id]);
      
      return rows;
    } catch (error) {
      console.error('Error getting orders by order_id:', error);
      throw new Error('Failed to get orders from database');
    }
  }

  /**
   * Get orders by multiple order_ids from MySQL (bulk fetch)
   * OPTIMIZATION: Fetches only specified orders instead of all orders
   * @param {Array<string>} order_ids - Array of order IDs
   * @returns {Array} Array of order objects
   */
  async getOrdersByOrderIds(order_ids) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return [];
    }

    try {
      // Create placeholders for IN clause (?, ?, ?, ...)
      const placeholders = order_ids.map(() => '?').join(',');
      
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        WHERE o.order_id IN (${placeholders})
        ORDER BY o.order_id, o.product_name
      `, order_ids);
      
      return rows || [];
    } catch (error) {
      console.error('Error getting orders by order_ids:', error);
      throw new Error('Failed to get orders from database');
    }
  }

  /**
   * Get multiple orders by unique_ids from MySQL (bulk fetch)
   * @param {Array<string>} unique_ids - Array of order unique IDs
   * @returns {Array} Array of order objects
   */
  async getOrdersByUniqueIds(unique_ids) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!unique_ids || !Array.isArray(unique_ids) || unique_ids.length === 0) {
      return [];
    }

    try {
      // Create placeholders for IN clause (?, ?, ?, ...)
      const placeholders = unique_ids.map(() => '?').join(',');
      
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        WHERE o.unique_id IN (${placeholders})
      `, unique_ids);
      
      return rows || [];
    } catch (error) {
      console.error('Error getting orders by unique_ids:', error);
      throw new Error('Failed to get orders from database');
    }
  }

  /**
   * Get all orders from MySQL
   * @returns {Array} Array of all orders
   */
  async getAllOrders(cutoffDate = null) {
    // Use pool if available (preferred for parallel execution), otherwise fall back to connection
    const db = this.mysqlPool || this.mysqlConnection;
    if (!db) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Build query with optional date filter using parameterized query
      let query = `
        SELECT 
          o.*,
          p.image as product_image,
          c.status as claims_status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest,
          l.manifest_id,
          l.current_shipment_status,
          l.is_handover,
          s.store_name,
          s.status as store_status,
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END as status
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        LEFT JOIN store_info s ON o.account_code = s.account_code
        WHERE (o.is_in_new_order = 1 OR c.label_downloaded = 1)`;
      
      const params = [];
      
      // Add date filter if cutoffDate is provided
      if (cutoffDate) {
        query += ` AND o.order_date >= ?`;
        // Format date for MySQL (YYYY-MM-DD HH:MM:SS)
        const mysqlDate = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
        params.push(mysqlDate);
      }
      
      query += ` ORDER BY o.order_date DESC, o.order_id, o.product_name`;
      
      const [rows] = await db.execute(query, params);
      
      return rows;
    } catch (error) {
      console.error('Error getting all orders:', error);
      throw new Error('Failed to get orders from database');
    }
  }

  /**
   * Get orders with pagination, filtering, and search (optimized with LIMIT/OFFSET)
   * @param {Object} options - Query options
   * @param {string} options.status - Filter by status (e.g., 'unclaimed')
   * @param {string} options.search - Search term for order_id, product_name, product_code, customer_name
   * @param {string} options.dateFrom - Start date (YYYY-MM-DD format)
   * @param {string} options.dateTo - End date (YYYY-MM-DD format)
   * @param {number} options.limit - Number of records per page
   * @param {number} options.offset - Number of records to skip
   * @returns {Promise<Object>} Object with orders array, totalCount, and totalQuantity
   */
  async getOrdersPaginated(options = {}) {
    const {
      status = null,
      search = '',
      dateFrom = null,
      dateTo = null,
      limit = 50,
      offset = 0
    } = options;

    // Use pool if available (preferred for parallel execution), otherwise fall back to connection
    const db = this.mysqlPool || this.mysqlConnection;
    if (!db) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Build WHERE clause conditions (reusable for both COUNT and SELECT queries)
      let whereConditions = '(o.is_in_new_order = 1 OR c.label_downloaded = 1)';
      const params = [];
      const countParams = [];
      
      // Apply status filter (unclaimed logic matches dashboard-stats)
      if (status === 'unclaimed') {
        whereConditions += ` AND (
          (
            (l.current_shipment_status IS NULL OR l.current_shipment_status = '') 
            AND c.status = 'unclaimed'
          )
          OR l.current_shipment_status = 'unclaimed'
        )`;
        // Filter out inactive stores for unclaimed orders (vendors should only see new orders from active stores)
        whereConditions += ` AND s.status = 'active'`;
      }
      
      // Apply search filter (SQL LIKE for order_id, product_name, product_code, customer_name)
      if (search && search.trim() !== '') {
        const searchTerm = `%${search.trim()}%`;
        whereConditions += ` AND (
          o.order_id LIKE ? OR
          o.product_name LIKE ? OR
          o.product_code LIKE ? OR
          o.customer_name LIKE ?
        )`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }
      
      // Apply date range filter
      if (dateFrom || dateTo) {
        if (dateFrom && dateTo) {
          whereConditions += ` AND o.order_date >= ? AND o.order_date <= ?`;
          const dateToEnd = dateTo + ' 23:59:59';
          params.push(dateFrom, dateToEnd);
          countParams.push(dateFrom, dateToEnd);
        } else if (dateFrom) {
          whereConditions += ` AND o.order_date >= ?`;
          params.push(dateFrom);
          countParams.push(dateFrom);
        } else if (dateTo) {
          whereConditions += ` AND o.order_date <= ?`;
          const dateToEnd = dateTo + ' 23:59:59';
          params.push(dateToEnd);
          countParams.push(dateToEnd);
        }
      }
      
      // Build data query with LIMIT/OFFSET
      const dataQuery = `
        SELECT 
          o.*,
          p.image as product_image,
          c.status as claims_status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest,
          l.manifest_id,
          l.current_shipment_status,
          l.is_handover,
          s.store_name,
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END as status
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        LEFT JOIN store_info s ON o.account_code = s.account_code
        WHERE ${whereConditions}
        ORDER BY o.order_date DESC, o.order_id, o.product_name
        LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
      
      // Build COUNT query for total count and quantity (same WHERE clause, includes store_info for status filtering)
      const countQuery = `
        SELECT 
          COUNT(DISTINCT o.unique_id) as total_count,
          COALESCE(SUM(o.quantity), 0) as total_quantity
        FROM orders o
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        LEFT JOIN store_info s ON o.account_code = s.account_code
        WHERE ${whereConditions}`;
      
      // Execute COUNT query and data query in parallel using connection pool
      // Note: LIMIT and OFFSET are interpolated directly (not parameterized) as MySQL doesn't support placeholders for them
      const [countResult, dataResult] = await Promise.all([
        db.execute(countQuery, countParams),
        db.execute(dataQuery, params)
      ]);
      
      const totalCount = parseInt(countResult[0][0]?.total_count || 0);
      const totalQuantity = parseInt(countResult[0][0]?.total_quantity || 0);
      const orders = dataResult[0];
      
      return {
        orders,
        totalCount,
        totalQuantity
      };
    } catch (error) {
      console.error('Error getting paginated orders:', error);
      throw new Error('Failed to get paginated orders from database');
    }
  }

  /**
   * Get admin orders with pagination, filtering, and search (optimized with LIMIT/OFFSET)
   * @param {Object} options - Query options
   * @param {string} options.search - Search term for order_id, product_name, product_code, customer_name
   * @param {string} options.dateFrom - Start date (YYYY-MM-DD format)
   * @param {string} options.dateTo - End date (YYYY-MM-DD format)
   * @param {string} options.status - Filter by status ('all', 'claimed', 'unclaimed', or specific status)
   * @param {string} options.vendor - Filter by vendor warehouse ID
   * @param {string} options.store - Filter by store account code
   * @param {boolean} options.showInactiveStores - Include orders from inactive stores (default: false)
   * @param {number} options.limit - Number of records per page
   * @param {number} options.offset - Number of records to skip
   * @param {Date} options.cutoffDate - Only include orders after this date
   * @returns {Promise<Object>} Object with orders array, totalCount, and totalQuantity
   */
  async getAdminOrdersPaginated(options = {}) {
    const {
      search = '',
      dateFrom = null,
      dateTo = null,
      status = 'all',
      vendor = null,
      store = null,
      showInactiveStores = false,
      limit = 50,
      offset = 0,
      cutoffDate = null
    } = options;

    // Use pool if available (preferred for parallel execution), otherwise fall back to connection
    const db = this.mysqlPool || this.mysqlConnection;
    if (!db) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Build WHERE clause conditions (reusable for both COUNT and SELECT queries)
      let whereConditions = '(o.is_in_new_order = 1 OR c.label_downloaded = 1)';
      const params = [];
      const countParams = [];
      
      // Apply cutoff date filter (for performance - only recent orders)
      if (cutoffDate) {
        whereConditions += ` AND o.order_date >= ?`;
        const mysqlDate = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
        params.push(mysqlDate);
        countParams.push(mysqlDate);
      }
      
      // Apply search filter (SQL LIKE for order_id, product_name, product_code, customer_name)
      if (search && search.trim() !== '') {
        const searchTerm = `%${search.trim()}%`;
        whereConditions += ` AND (
          o.order_id LIKE ? OR
          o.product_name LIKE ? OR
          o.product_code LIKE ? OR
          o.customer_name LIKE ?
        )`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }
      
      // Apply date range filter
      if (dateFrom || dateTo) {
        if (dateFrom && dateTo) {
          whereConditions += ` AND o.order_date >= ? AND o.order_date <= ?`;
          const dateToEnd = dateTo + ' 23:59:59';
          params.push(dateFrom, dateToEnd);
          countParams.push(dateFrom, dateToEnd);
        } else if (dateFrom) {
          whereConditions += ` AND o.order_date >= ?`;
          params.push(dateFrom);
          countParams.push(dateFrom);
        } else if (dateTo) {
          whereConditions += ` AND o.order_date <= ?`;
          const dateToEnd = dateTo + ' 23:59:59';
          params.push(dateToEnd);
          countParams.push(dateToEnd);
        }
      }
      
      // Apply status filter
      if (status && status !== 'all') {
        whereConditions += ` AND (
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END = ?
        )`;
        params.push(status);
        countParams.push(status);
      }
      
      // Apply vendor filter
      if (vendor && vendor.trim() !== '') {
        whereConditions += ` AND c.claimed_by = ?`;
        params.push(vendor.trim());
        countParams.push(vendor.trim());
      }
      
      // Apply store filter
      if (store && store.trim() !== '') {
        whereConditions += ` AND o.account_code = ?`;
        params.push(store.trim());
        countParams.push(store.trim());
      }
      
      // Filter inactive stores unless explicitly requested
      if (!showInactiveStores) {
        whereConditions += ` AND (s.status = 'active' OR s.status IS NULL)`;
        // Note: OR s.status IS NULL handles edge case where store_info might not have a record
      }
      
      // Build data query with LIMIT/OFFSET and vendor info
      const dataQuery = `
        SELECT 
          o.*,
          p.image as product_image,
          c.status as claims_status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest,
          l.manifest_id,
          l.current_shipment_status,
          l.is_handover,
          s.store_name,
          s.status as store_status,
          u.name as vendor_name,
          u.warehouseId as vendor_warehouse_id,
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END as status
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        LEFT JOIN store_info s ON o.account_code = s.account_code
        LEFT JOIN users u ON c.claimed_by = u.warehouseId
        WHERE ${whereConditions}
        ORDER BY o.order_date DESC, o.order_id, o.product_name
        LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
      
      // Build COUNT query for total count and quantity
      const countQuery = `
        SELECT 
          COUNT(DISTINCT o.unique_id) as total_count,
          COALESCE(SUM(o.quantity), 0) as total_quantity
        FROM orders o
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        LEFT JOIN store_info s ON o.account_code = s.account_code
        WHERE ${whereConditions}`;
      
      // Execute COUNT query and data query in parallel using connection pool
      const [countResult, dataResult] = await Promise.all([
        db.execute(countQuery, countParams),
        db.execute(dataQuery, params)
      ]);
      
      const totalCount = parseInt(countResult[0][0]?.total_count || 0);
      const totalQuantity = parseInt(countResult[0][0]?.total_quantity || 0);
      const orders = dataResult[0];
      
      console.log(`📊 Admin Orders Paginated: Found ${totalCount} total orders, returning ${orders.length} orders (offset: ${offset}, limit: ${limit})`);
      
      return {
        orders,
        totalCount,
        totalQuantity
      };
    } catch (error) {
      console.error('Error getting admin paginated orders:', error);
      throw new Error('Failed to get admin paginated orders from database');
    }
  }

  /**
   * Get admin dashboard statistics (total counts for cards)
   * @param {Object} options - Filter options
   * @param {string} options.search - Search term
   * @param {string} options.dateFrom - Start date (YYYY-MM-DD format)
   * @param {string} options.dateTo - End date (YYYY-MM-DD format)
   * @param {string} options.status - Filter by status
   * @param {string} options.vendor - Filter by vendor warehouse ID
   * @param {string} options.store - Filter by store account code
   * @param {boolean} options.showInactiveStores - Include inactive stores
   * @param {Date} options.cutoffDate - Only include orders after this date
   * @returns {Promise<Object>} Statistics object
   */
  async getAdminDashboardStats(options = {}) {
    const {
      search = '',
      dateFrom = null,
      dateTo = null,
      status = 'all',
      vendor = null,
      store = null,
      showInactiveStores = false,
      cutoffDate = null
    } = options;

    // Use pool if available (preferred for parallel execution)
    const db = this.mysqlPool || this.mysqlConnection;
    if (!db) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Build WHERE clause conditions (same as pagination for consistency)
      let whereConditions = '(o.is_in_new_order = 1 OR c.label_downloaded = 1)';
      const params = [];
      
      // Apply cutoff date filter
      if (cutoffDate) {
        whereConditions += ` AND o.order_date >= ?`;
        const mysqlDate = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
        params.push(mysqlDate);
      }
      
      // Apply search filter
      if (search && search.trim() !== '') {
        const searchTerm = `%${search.trim()}%`;
        whereConditions += ` AND (
          o.order_id LIKE ? OR
          o.product_name LIKE ? OR
          o.product_code LIKE ? OR
          o.customer_name LIKE ?
        )`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }
      
      // Apply date range filter
      if (dateFrom || dateTo) {
        if (dateFrom && dateTo) {
          whereConditions += ` AND o.order_date >= ? AND o.order_date <= ?`;
          const dateToEnd = dateTo + ' 23:59:59';
          params.push(dateFrom, dateToEnd);
        } else if (dateFrom) {
          whereConditions += ` AND o.order_date >= ?`;
          params.push(dateFrom);
        } else if (dateTo) {
          whereConditions += ` AND o.order_date <= ?`;
          const dateToEnd = dateTo + ' 23:59:59';
          params.push(dateToEnd);
        }
      }
      
      // Apply vendor filter
      if (vendor && vendor.trim() !== '') {
        whereConditions += ` AND c.claimed_by = ?`;
        params.push(vendor.trim());
      }
      
      // Apply store filter
      if (store && store.trim() !== '') {
        whereConditions += ` AND o.account_code = ?`;
        params.push(store.trim());
      }
      
      // Filter inactive stores unless explicitly requested
      if (!showInactiveStores) {
        whereConditions += ` AND (s.status = 'active' OR s.status IS NULL)`;
        // Note: OR s.status IS NULL handles edge case where store_info might not have a record
      }
      
      // If status filter is applied, we calculate stats for that status only
      // Otherwise, calculate all stats in parallel
      if (status && status !== 'all') {
        whereConditions += ` AND (
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END = ?
        )`;
        params.push(status);
        
        // Single query for filtered status
        const query = `
          SELECT 
            COUNT(DISTINCT o.unique_id) as total_count,
            COALESCE(SUM(o.quantity), 0) as total_quantity
          FROM orders o
          LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
          LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
          LEFT JOIN store_info s ON o.account_code = s.account_code
          WHERE ${whereConditions}`;
        
        const [result] = await db.execute(query, params);
        const totalCount = parseInt(result[0]?.total_count || 0);
        const totalQuantity = parseInt(result[0]?.total_quantity || 0);
        
        return {
          totalOrders: totalCount,
          totalQuantity: totalQuantity,
          claimedOrders: status === 'claimed' ? totalCount : 0,
          unclaimedOrders: status === 'unclaimed' ? totalCount : 0,
          hasFilters: !!(search || dateFrom || dateTo || vendor || store || (status !== 'all'))
        };
      }
      
      // Calculate all stats in parallel (total, claimed, unclaimed)
      const totalQuery = `
        SELECT 
          COUNT(DISTINCT o.unique_id) as total_count,
          COALESCE(SUM(o.quantity), 0) as total_quantity
        FROM orders o
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        LEFT JOIN store_info s ON o.account_code = s.account_code
        WHERE ${whereConditions}`;
      
      const claimedQuery = `
        SELECT 
          COUNT(DISTINCT o.unique_id) as total_count,
          COALESCE(SUM(o.quantity), 0) as total_quantity
        FROM orders o
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        LEFT JOIN store_info s ON o.account_code = s.account_code
        WHERE ${whereConditions}
        AND (
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END = 'claimed'
        )`;
      
      const unclaimedQuery = `
        SELECT 
          COUNT(DISTINCT o.unique_id) as total_count,
          COALESCE(SUM(o.quantity), 0) as total_quantity
        FROM orders o
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        LEFT JOIN store_info s ON o.account_code = s.account_code
        WHERE ${whereConditions}
        AND (
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END = 'unclaimed'
        )`;
      
      // Execute all 3 queries in parallel using connection pool
      const [totalResult, claimedResult, unclaimedResult] = await Promise.all([
        db.execute(totalQuery, params),
        db.execute(claimedQuery, params),
        db.execute(unclaimedQuery, params)
      ]);
      
      const totalCount = parseInt(totalResult[0][0]?.total_count || 0);
      const totalQuantity = parseInt(totalResult[0][0]?.total_quantity || 0);
      const claimedCount = parseInt(claimedResult[0][0]?.total_count || 0);
      const unclaimedCount = parseInt(unclaimedResult[0][0]?.total_count || 0);
      
      console.log(`📊 Admin Dashboard Stats: Total=${totalCount}, Claimed=${claimedCount}, Unclaimed=${unclaimedCount}`);
      
      return {
        totalOrders: totalCount,
        totalQuantity: totalQuantity,
        claimedOrders: claimedCount,
        unclaimedOrders: unclaimedCount,
        hasFilters: !!(search || dateFrom || dateTo || vendor || store)
      };
    } catch (error) {
      console.error('Error getting admin dashboard stats:', error);
      throw new Error('Failed to get admin dashboard stats from database');
    }
  }

  /**
   * Get orders claimed by a specific vendor from MySQL
   * @param {string} warehouseId - Vendor warehouse ID
   * @returns {Array} Array of claimed orders
   */
  async getOrdersByVendor(warehouseId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        WHERE c.claimed_by = ? AND (o.is_in_new_order = 1 OR c.label_downloaded = 1) 
        ORDER BY c.claimed_at DESC
      `, [warehouseId]);
      
      return rows;
    } catch (error) {
      console.error('Error getting orders by vendor:', error);
      throw new Error('Failed to get vendor orders from database');
    }
  }

  /**
   * Get individual orders for a vendor from MySQL (for frontend grouping)
   * This returns individual orders like the original Excel flow
   * @param {string} warehouseId - Vendor warehouse ID
   * @returns {Array} Array of individual orders
   */
  async getGroupedOrders(warehouseId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status as claims_status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest,
          l.current_shipment_status,
          l.is_handover,
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END as status
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        WHERE c.claimed_by = ? 
        AND (c.status = 'claimed' OR c.status = 'ready_for_handover')
        AND (o.is_in_new_order = 1 OR c.label_downloaded = 1)
        AND (l.is_manifest IS NULL OR l.is_manifest = 0)
        ORDER BY o.order_date DESC, o.order_id
      `, [warehouseId]);
      
      return rows;
    } catch (error) {
      console.error('Error getting vendor orders:', error);
      throw new Error('Failed to get vendor orders from database');
    }
  }

  /**
   * Get My Orders (orders that are claimed but not yet manifested)
   * @param {string} warehouseId - Vendor warehouse ID
   * @returns {Array} Array of individual orders for My Orders section
   */
  async getMyOrders(warehouseId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status as claims_status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest,
          l.current_shipment_status,
          l.is_handover,
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END as status
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id
        WHERE c.claimed_by = ? 
        AND (c.status = 'claimed' OR c.status = 'ready_for_handover')
        AND (l.is_manifest IS NULL OR l.is_manifest = 0)
        ORDER BY o.order_date DESC, o.order_id
      `, [warehouseId]);
      
      return rows;
    } catch (error) {
      console.error('Error getting My Orders:', error);
      throw new Error('Failed to get My Orders from database');
    }
  }

  /**
   * Get Handover Orders (orders that have been manifested within last 24 hours)
   * @param {string} warehouseId - Vendor warehouse ID
   * @returns {Array} Array of individual orders for Handover section (< 24 hrs from handover_at)
   */
  async getHandoverOrders(warehouseId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status as claims_status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest,
          l.manifest_id,
          l.current_shipment_status,
          l.is_handover,
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END as status
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        WHERE c.claimed_by = ? 
        AND (c.status = 'claimed' OR c.status = 'ready_for_handover')
        AND (o.is_in_new_order = 1 OR c.label_downloaded = 1)
        AND l.is_manifest = 1
        AND (l.is_handover = 0 OR l.is_handover IS NULL)
        ORDER BY o.order_date DESC, o.order_id
      `, [warehouseId]);
      
      return rows;
    } catch (error) {
      console.error('Error getting Handover Orders:', error);
      throw new Error('Failed to get Handover Orders from database');
    }
  }

  /**
   * Get Order Tracking Orders (orders that have been handed over - is_handover = 1)
   * @param {string} warehouseId - Vendor warehouse ID
   * @returns {Array} Array of individual orders for Order Tracking section (is_handover = 1)
   */
  async getOrderTrackingOrders(warehouseId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.*,
          p.image as product_image,
          c.status as claims_status,
          c.claimed_by,
          c.claimed_at,
          c.last_claimed_by,
          c.last_claimed_at,
          c.clone_status,
          c.cloned_order_id,
          c.is_cloned_row,
          c.label_downloaded,
          l.label_url,
          l.awb,
          l.carrier_id,
          l.carrier_name,
          l.handover_at,
          c.priority_carrier,
          l.is_manifest,
          l.manifest_id,
          l.current_shipment_status,
          l.is_handover,
          CASE 
            WHEN l.current_shipment_status IS NOT NULL AND l.current_shipment_status != '' 
            THEN l.current_shipment_status 
            ELSE c.status 
          END as status
        FROM orders o
        LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        LEFT JOIN labels l ON o.order_id = l.order_id AND o.account_code = l.account_code
        WHERE c.claimed_by = ? 
        AND (c.status = 'claimed' OR c.status = 'ready_for_handover')
        AND (o.is_in_new_order = 1 OR c.label_downloaded = 1)
        AND l.is_manifest = 1
        AND l.is_handover = 1
        ORDER BY o.order_date DESC, o.order_id
      `, [warehouseId]);
      
      return rows;
    } catch (error) {
      console.error('Error getting Order Tracking Orders:', error);
      throw new Error('Failed to get Order Tracking Orders from database');
    }
  }

  /**
   * Update order in MySQL
   * @param {string} unique_id - Order unique ID
   * @param {Object} updateData - Data to update
   * @returns {Object|null} Updated order or null if not found
   */
  async updateOrder(unique_id, updateData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Separate fields for orders, claims, and labels tables
      const orderFields = [];
      const orderValues = [];
      const claimFields = [];
      const claimValues = [];
      const labelFields = [];
      const labelValues = [];

      // Orders table fields
      const allowedOrderFields = [
        'order_id', 'customer_name', 'order_date',
        'product_name', 'product_code', 'selling_price', 'order_total',
        'payment_type', 'is_partial_paid', 'prepaid_amount', 'order_total_ratio', 'order_total_split',
        'collectable_amount', 'pincode', 'is_in_new_order'
      ];

      // Claims table fields
      const allowedClaimFields = [
        'order_id', 'status', 'claimed_by', 'claimed_at', 'last_claimed_by', 'last_claimed_at',
        'clone_status', 'cloned_order_id', 'is_cloned_row', 'label_downloaded', 'priority_carrier'
      ];

      // Labels table fields
      const allowedLabelFields = [
        'label_url', 'awb', 'carrier_name', 'handover_at'
      ];

      // Separate the fields
      allowedOrderFields.forEach(field => {
        if (updateData[field] !== undefined) {
          orderFields.push(`${field} = ?`);
          orderValues.push(updateData[field]);
        }
      });

      allowedClaimFields.forEach(field => {
        if (updateData[field] !== undefined) {
          claimFields.push(`${field} = ?`);
          claimValues.push(updateData[field]);
        }
      });

      allowedLabelFields.forEach(field => {
        if (updateData[field] !== undefined) {
          labelFields.push(`${field} = ?`);
          labelValues.push(updateData[field]);
        }
      });

      // Update orders table if there are order fields to update
      if (orderFields.length > 0) {
        orderValues.push(unique_id);
        const [orderResult] = await this.mysqlConnection.execute(
          `UPDATE orders SET ${orderFields.join(', ')} WHERE unique_id = ?`,
          orderValues
        );
        
        // Don't return early - we still need to update claims and labels tables
        // if (orderResult.affectedRows === 0) {
        //   return null;
        // }
      }

      // Update claims table if there are claim fields to update
      if (claimFields.length > 0) {
        // First, ensure a claim record exists for this unique_id
        await this.mysqlConnection.execute(`
          INSERT INTO claims (order_unique_id, order_id, account_code) 
          SELECT o.unique_id, o.order_id, o.account_code FROM orders o WHERE o.unique_id = ?
          ON DUPLICATE KEY UPDATE order_unique_id = VALUES(order_unique_id), account_code = VALUES(account_code)
        `, [unique_id]);

        claimValues.push(unique_id);
        await this.mysqlConnection.execute(
          `UPDATE claims SET ${claimFields.join(', ')} WHERE order_unique_id = ?`,
          claimValues
        );
      }

      // Update labels table if there are label fields to update
      if (labelFields.length > 0) {
        // First, get the order_id for this unique_id
        const [orderRows] = await this.mysqlConnection.execute(
          'SELECT order_id FROM orders WHERE unique_id = ?',
          [unique_id]
        );

        if (orderRows.length > 0) {
          const orderId = orderRows[0].order_id;

          // Get the account_code from orders table
          const [orderData] = await this.mysqlConnection.execute(
            'SELECT account_code FROM orders WHERE order_id = ? LIMIT 1',
            [orderId]
          );
          if (orderData.length === 0 || !orderData[0].account_code) {
            throw new Error(`Order ${orderId} not found or missing account_code`);
          }
          const accountCode = orderData[0].account_code;

          // Ensure a label record exists for this order_id
          await this.mysqlConnection.execute(`
            INSERT INTO labels (order_id, account_code) 
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE order_id = VALUES(order_id), account_code = VALUES(account_code)
          `, [orderId, accountCode]);

          // CRITICAL: Filter by both order_id AND account_code to ensure store-specific update
          labelValues.push(orderId, accountCode);
          await this.mysqlConnection.execute(
            `UPDATE labels SET ${labelFields.join(', ')} WHERE order_id = ? AND account_code = ?`,
            labelValues
          );
        }
      }

      // If no fields to update at all
      if (orderFields.length === 0 && claimFields.length === 0 && labelFields.length === 0) {
        throw new Error('No fields to update');
      }

      return await this.getOrderByUniqueId(unique_id);
    } catch (error) {
      console.error('Error updating order:', error);
      throw new Error('Failed to update order');
    }
  }

  /**
   * Bulk update orders in MySQL
   * @param {Array} updates - Array of {unique_id, updateData} objects
   * @returns {Array} Array of updated orders
   */
  async bulkUpdateOrders(updates) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const updatedOrders = [];
      
      for (const update of updates) {
        const updatedOrder = await this.updateOrder(update.unique_id, update.updateData);
        if (updatedOrder) {
          updatedOrders.push(updatedOrder);
        }
      }

      return updatedOrders;
    } catch (error) {
      console.error('Error bulk updating orders:', error);
      throw new Error('Failed to bulk update orders');
    }
  }

  /**
   * Delete order from MySQL
   * @param {string} unique_id - Order unique ID
   * @returns {boolean} True if deleted, false if not found
   */
  async deleteOrder(unique_id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [result] = await this.mysqlConnection.execute(
        'DELETE FROM orders WHERE unique_id = ?',
        [unique_id]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting order:', error);
      throw new Error('Failed to delete order');
    }
  }

  /**
   * Search orders in MySQL
   * @param {string} searchTerm - Search term
   * @returns {Array} Array of matching orders
   */
  async searchOrders(searchTerm) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        `SELECT o.*, p.image as product_image
         FROM orders o
         LEFT JOIN products p ON (
          (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
          REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
          AND o.account_code = p.account_code
        )
         LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
         WHERE (o.order_id LIKE ? OR o.customer_name LIKE ? OR o.product_name LIKE ? 
         OR o.product_code LIKE ? OR o.pincode LIKE ?)
         AND (o.is_in_new_order = 1 OR c.label_downloaded = 1)
         ORDER BY o.order_date DESC, o.order_id`,
        [
          `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`,
          `%${searchTerm}%`, `%${searchTerm}%`
        ]
      );
      return rows;
    } catch (error) {
      console.error('Error searching orders:', error);
      throw new Error('Failed to search orders');
    }
  }

  /**
   * Wait for MySQL initialization to complete
   * @returns {Promise<boolean>} True if MySQL is available
   */
  async waitForMySQLInitialization() {
    // Wait for initialization to complete
    while (!this.mysqlInitialized) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.mysqlConnection !== null;
  }

  /**
   * Check if MySQL connection is available
   * @returns {boolean} True if MySQL is available
   */
  isMySQLAvailable() {
    // Check pool first (preferred), then fall back to connection for backward compatibility
    return (this.mysqlPool !== null) || (this.mysqlConnection !== null);
  }

  /**
   * Test database connection health
   * @returns {Promise<boolean>} True if connection is healthy
   */
  async testConnection() {
    if (!this.mysqlConnection) {
      return false;
    }

    try {
      await this.mysqlConnection.execute('SELECT 1');
      return true;
    } catch (error) {
      console.error('❌ Database connection test failed:', error.message);
      
      // Check if it's a connection lost error
      if (error.code === 'PROTOCOL_CONNECTION_LOST' || 
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND') {
        console.log('🔄 Stale connection detected');
      }
      
      return false;
    }
  }

  /**
   * Reconnect to database if connection is lost
   * @returns {Promise<boolean>} True if reconnection successful
   */
  async reconnect() {
    try {
      console.log('🔄 Attempting to reconnect to database...');
      
      // Close existing connection
      if (this.mysqlConnection) {
        try {
          await this.mysqlConnection.end();
        } catch (error) {
          console.log('ℹ️ Error closing old connection (expected if connection was lost):', error.message);
        }
      }
      
      // Reset state
      this.mysqlConnection = null;
      this.mysqlInitialized = false;
      
      // Reinitialize connection
      await this.initializeMySQL();
      
      console.log('✅ Database reconnected successfully');
      return true;
    } catch (error) {
      console.error('❌ Database reconnection failed:', error.message);
      return false;
    }
  }

  /**
   * Labels Table CRUD Operations
   */

  /**
   * Get label by order_id
   * @param {string} orderId - Order ID (can be clone order ID)
   * @returns {Object|null} Label data or null if not found
   */
  async getLabelByOrderId(orderId, accountCode = null) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      let query = 'SELECT * FROM labels WHERE order_id = ?';
      const params = [orderId];
      
      // If account_code is provided, filter by it to ensure store-specific label retrieval
      if (accountCode) {
        query += ' AND account_code = ?';
        params.push(accountCode);
      }
      
      const [rows] = await this.mysqlConnection.execute(query, params);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting label by order ID:', error);
      throw new Error('Failed to get label from database');
    }
  }

  /**
   * Create or update label
   * @param {Object} labelData - Label data {order_id, label_url, awb}
   * @returns {Object} Created/updated label
   */
  async upsertLabel(labelData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!labelData.account_code) {
      throw new Error('account_code is required for creating/updating label');
    }

    try {
      // Handle partial updates by only updating provided fields
      const updateFields = [];
      const updateValues = [];
      
      // Build dynamic update clause based on provided fields
      if (labelData.hasOwnProperty('label_url')) {
        updateFields.push('label_url = ?');
        updateValues.push(labelData.label_url);
      }
      if (labelData.hasOwnProperty('awb')) {
        updateFields.push('awb = ?');
        updateValues.push(labelData.awb || null);
      }
      if (labelData.hasOwnProperty('carrier_id')) {
        updateFields.push('carrier_id = ?');
        updateValues.push(labelData.carrier_id || null);
      }
      if (labelData.hasOwnProperty('carrier_name')) {
        updateFields.push('carrier_name = ?');
        updateValues.push(labelData.carrier_name || null);
      }
      if (labelData.hasOwnProperty('priority_carrier')) {
        updateFields.push('priority_carrier = ?');
        updateValues.push(labelData.priority_carrier || null);
      }
      if (labelData.hasOwnProperty('is_manifest')) {
        updateFields.push('is_manifest = ?');
        updateValues.push(labelData.is_manifest || 0);
      }
      if (labelData.hasOwnProperty('manifest_id')) {
        updateFields.push('manifest_id = ?');
        updateValues.push(labelData.manifest_id || null);
      }
      
      // Always add updated_at
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      
      const updateClause = updateFields.join(', ');
      
      const [result] = await this.mysqlConnection.execute(
        `INSERT INTO labels (order_id, label_url, awb, carrier_id, carrier_name, priority_carrier, is_manifest, manifest_id, account_code) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE ${updateClause}`,
        [
          labelData.order_id,
          labelData.label_url || null,
          labelData.awb || null,
          labelData.carrier_id || null,
          labelData.carrier_name || null,
          labelData.priority_carrier || null,
          labelData.is_manifest || 0,
          labelData.manifest_id || null,
          labelData.account_code,
          ...updateValues
        ]
      );

      // CRITICAL: Retrieve label with account_code to ensure store-specific retrieval
      return await this.getLabelByOrderId(labelData.order_id, labelData.account_code);
    } catch (error) {
      console.error('Error creating/updating label:', error);
      throw new Error('Failed to save label to database');
    }
  }

  /**
   * Get multiple labels by order_ids (bulk fetch)
   * OPTIMIZATION: Fetches all labels in one query instead of N queries
   * @param {Array<string>} order_ids - Array of order IDs
   * @returns {Array} Array of label objects
   */
  async getLabelsByOrderIds(order_ids) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return [];
    }

    try {
      // Create placeholders for IN clause (?, ?, ?, ...)
      const placeholders = order_ids.map(() => '?').join(',');
      
      const [rows] = await this.mysqlConnection.execute(
        `SELECT * FROM labels WHERE order_id IN (${placeholders})`,
        order_ids
      );
      
      return rows || [];
    } catch (error) {
      console.error('Error getting labels by order_ids:', error);
      throw new Error('Failed to get labels from database');
    }
  }

  /**
   * Check if label exists for order_id
   * @param {string} orderId - Order ID
   * @returns {boolean} True if label exists
   */
  async labelExists(orderId) {
    const label = await this.getLabelByOrderId(orderId);
    return label !== null;
  }

  /**
   * Get all labels
   * @returns {Array} Array of all labels
   */
  async getAllLabels() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM labels ORDER BY created_at DESC'
      );
      return rows;
    } catch (error) {
      console.error('Error getting all labels:', error);
      throw new Error('Failed to get labels from database');
    }
  }

  // ========================================
  // Customer Info Methods
  // ========================================

  /**
   * Get customer info by order ID
   * @param {string} orderId - Order ID
   * @returns {Object|null} Customer info or null if not found
   */
  async getCustomerInfoByOrderId(orderId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM customer_info WHERE order_id = ?',
        [orderId]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting customer info by order ID:', error);
      throw new Error('Failed to get customer info from database');
    }
  }

  /**
   * Get multiple customer info by order_ids (bulk fetch)
   * OPTIMIZATION: Fetches all customer info in one query instead of N queries
   * @param {Array<string>} order_ids - Array of order IDs
   * @returns {Array} Array of customer info objects
   */
  async getCustomerInfoByOrderIds(order_ids) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return [];
    }

    try {
      const placeholders = order_ids.map(() => '?').join(',');
      
      const [rows] = await this.mysqlConnection.execute(
        `SELECT * FROM customer_info WHERE order_id IN (${placeholders})`,
        order_ids
      );
      
      return rows || [];
    } catch (error) {
      console.error('Error getting customer info by order_ids:', error);
      throw new Error('Failed to get customer info from database');
    }
  }

  /**
   * Create or update customer info
   * @param {Object} customerData - Customer data
   * @returns {Object} Created/updated customer info
   */
  async upsertCustomerInfo(customerData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!customerData.account_code) {
      throw new Error('account_code is required for creating/updating customer info');
    }

    try {
      const fields = [
        'store_code',
        'email', 'billing_firstname', 'billing_lastname', 'billing_phone',
        'billing_address', 'billing_address2', 'billing_city', 'billing_state',
        'billing_country', 'billing_zipcode', 'billing_latitude', 'billing_longitude',
        'shipping_firstname', 'shipping_lastname', 'shipping_phone',
        'shipping_address', 'shipping_address2', 'shipping_city', 'shipping_state',
        'shipping_country', 'shipping_zipcode', 'shipping_latitude', 'shipping_longitude',
        'account_code'
      ];

      const updateClauses = fields.map(field => `${field} = VALUES(${field})`).join(', ');
      const fieldNames = ['order_id', ...fields].join(', ');
      const placeholders = ['order_id', ...fields].map(() => '?').join(', ');

      const values = [
        customerData.order_id,
        customerData.store_code || null,
        customerData.email || null,
        customerData.billing_firstname || null,
        customerData.billing_lastname || null,
        customerData.billing_phone || null,
        customerData.billing_address || null,
        customerData.billing_address2 || null,
        customerData.billing_city || null,
        customerData.billing_state || null,
        customerData.billing_country || null,
        customerData.billing_zipcode || null,
        customerData.billing_latitude || null,
        customerData.billing_longitude || null,
        customerData.shipping_firstname || null,
        customerData.shipping_lastname || null,
        customerData.shipping_phone || null,
        customerData.shipping_address || null,
        customerData.shipping_address2 || null,
        customerData.shipping_city || null,
        customerData.shipping_state || null,
        customerData.shipping_country || null,
        customerData.shipping_zipcode || null,
        customerData.shipping_latitude || null,
        customerData.shipping_longitude || null,
        customerData.account_code
      ];

      await this.mysqlConnection.execute(
        `INSERT INTO customer_info (${fieldNames}) VALUES (${placeholders})
         ON DUPLICATE KEY UPDATE ${updateClauses}`,
        values
      );

      return await this.getCustomerInfoByOrderId(customerData.order_id);
    } catch (error) {
      console.error('Error creating/updating customer info:', error);
      throw new Error('Failed to save customer info to database');
    }
  }

  /**
   * Copy customer info from one order to another (for clones)
   * @param {string} sourceOrderId - Source order ID
   * @param {string} targetOrderId - Target order ID (clone)
   * @returns {Object} Copied customer info
   */
  async copyCustomerInfo(sourceOrderId, targetOrderId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Get source customer info
      const sourceCustomer = await this.getCustomerInfoByOrderId(sourceOrderId);
      
      if (!sourceCustomer) {
        throw new Error(`Customer info not found for order ${sourceOrderId}`);
      }

      // Create new customer info with target order_id
      const targetCustomer = {
        ...sourceCustomer,
        order_id: targetOrderId
      };

      // Remove timestamps to let database generate new ones
      delete targetCustomer.created_at;
      delete targetCustomer.updated_at;

      // Insert the copied customer info
      await this.upsertCustomerInfo(targetCustomer);

      console.log(`✅ Copied customer info from ${sourceOrderId} to ${targetOrderId}`);
      return await this.getCustomerInfoByOrderId(targetOrderId);
    } catch (error) {
      console.error('Error copying customer info:', error);
      throw new Error(`Failed to copy customer info: ${error.message}`);
    }
  }

  /**
   * Generic query method for executing SQL queries
   * @param {string} sql - SQL query string
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Array of result rows
   */
  async query(sql, params = []) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(sql, params);
      return rows;
    } catch (error) {
      console.error('Error executing query:', error);
      throw error;
    }
  }

  // ==================== ORDER TRACKING METHODS ====================

  /**
   * Get active orders that need tracking updates
   * Active orders: label_downloaded = 1 from claims table
   * Note: We determine active/inactive based on latest shipment_status from Shipway API
   */
  async getActiveOrdersForTracking() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT DISTINCT c.order_id, o.account_code 
        FROM claims c
        INNER JOIN orders o ON c.order_id = o.order_id AND c.account_code = o.account_code
        WHERE c.label_downloaded = 1 
        AND c.order_id IS NOT NULL
        AND o.account_code IS NOT NULL
        ORDER BY c.order_id
      `);
      return rows;
    } catch (error) {
      console.error('Error getting active orders for tracking:', error);
      throw error;
    }
  }

  /**
   * Get inactive orders that need tracking updates
   * Inactive orders: label_downloaded = 1 from claims table
   * Note: We determine active/inactive based on latest shipment_status from Shipway API
   */
  async getInactiveOrdersForTracking() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT DISTINCT c.order_id, o.account_code 
        FROM claims c
        INNER JOIN orders o ON c.order_id = o.order_id AND c.account_code = o.account_code
        WHERE c.label_downloaded = 1 
        AND c.order_id IS NOT NULL
        AND o.account_code IS NOT NULL
        ORDER BY c.order_id
      `);
      return rows;
    } catch (error) {
      console.error('Error getting inactive orders for tracking:', error);
      throw error;
    }
  }

  /**
   * Get orders that need auto-manifest (is_handover = 1 but is_manifest = 0)
   * @returns {Array} Array of orders needing manifest with account_code
   */
  async getOrdersNeedingAutoManifest() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT DISTINCT 
          l.order_id,
          l.awb,
          l.current_shipment_status,
          l.is_handover,
          l.is_manifest,
          o.account_code,
          o.customer_name,
          o.product_name
        FROM labels l
        INNER JOIN orders o ON l.order_id = o.order_id AND l.account_code = o.account_code
        WHERE l.is_handover = 1 
        AND (l.is_manifest = 0 OR l.is_manifest IS NULL)
        AND o.account_code IS NOT NULL
        ORDER BY l.order_id
      `);
      return rows;
    } catch (error) {
      console.error('Error getting orders needing auto-manifest:', error);
      throw error;
    }
  }

  /**
   * Store order tracking data
   * @param {string} orderId - The order ID
   * @param {string} orderType - 'active' or 'inactive'
   * @param {Array} trackingEvents - Array of tracking events from Shipway API
   */
  async storeOrderTracking(orderId, orderType, trackingEvents) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Get account_code from orders table
      const [orderData] = await this.mysqlConnection.execute(
        'SELECT account_code FROM orders WHERE order_id = ? LIMIT 1',
        [orderId]
      );
      if (orderData.length === 0 || !orderData[0].account_code) {
        throw new Error(`Order ${orderId} not found or missing account_code`);
      }
      const accountCode = orderData[0].account_code;

      // Clear existing tracking data for this order to avoid duplicates (with account_code for store isolation)
      await this.mysqlConnection.execute(
        'DELETE FROM order_tracking WHERE order_id = ? AND account_code = ?',
        [orderId, accountCode]
      );

      // Insert new tracking events
      for (const event of trackingEvents) {
        await this.mysqlConnection.execute(`
          INSERT INTO order_tracking 
          (order_id, order_type, shipment_status, timestamp, ndr_reason, account_code)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          orderId,
          orderType,
          event.name || 'Unknown',
          event.time || new Date(),
          event.ndr_reason || null,
          accountCode
        ]);
      }
      
      console.log(`✅ Stored ${trackingEvents.length} tracking events for order ${orderId}`);
      
    } catch (error) {
      console.error(`❌ Error storing tracking data for order ${orderId}:`, error);
      throw error;
    }
  }

  /**
   * Get tracking data for a specific order
   * @param {string} orderId - The order ID
   * @param {string} accountCode - The account_code for the store (REQUIRED)
   */
  async getOrderTracking(orderId, accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!accountCode) {
      throw new Error('account_code is required for getting tracking data');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          id,
          order_id,
          order_type,
          shipment_status,
          timestamp,
          ndr_reason,
          account_code,
          created_at,
          updated_at
        FROM order_tracking 
        WHERE order_id = ? AND account_code = ?
        ORDER BY timestamp ASC
      `, [orderId, accountCode]);
      
      return rows;
    } catch (error) {
      console.error(`Error getting tracking data for order ${orderId} (${accountCode}):`, error);
      throw error;
    }
  }

  /**
   * Get all orders with their latest tracking status
   */
  async getOrdersWithTrackingStatus() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          o.order_id,
          o.customer_name,
          o.status as order_status,
          o.label_downloaded,
          ot.order_type,
          ot.shipment_status as latest_shipment_status,
          ot.timestamp as latest_tracking_time
        FROM orders o
        LEFT JOIN (
          SELECT 
            order_id,
            order_type,
            shipment_status,
            timestamp,
            ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY timestamp DESC) as rn
          FROM order_tracking
        ) ot ON o.order_id = ot.order_id AND ot.rn = 1
        WHERE o.label_downloaded = 1
        ORDER BY o.order_id
      `);
      
      return rows;
    } catch (error) {
      console.error('Error getting orders with tracking status:', error);
      throw error;
    }
  }

  /**
   * Cleanup old tracking data (older than specified days)
   * @param {number} daysOld - Number of days old (default: 90)
   */
  async cleanupOldOrderTracking(daysOld = 90) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [result] = await this.mysqlConnection.execute(`
        DELETE FROM order_tracking 
        WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      `, [daysOld]);
      
      return {
        deletedCount: result.affectedRows,
        message: `Deleted ${result.affectedRows} old tracking records`
      };
    } catch (error) {
      console.error('Error cleaning up old tracking data:', error);
      throw error;
    }
  }

  /**
   * Get tracking statistics
   */
  async getTrackingStatistics() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [stats] = await this.mysqlConnection.execute(`
        SELECT 
          COUNT(DISTINCT order_id) as total_orders_tracked,
          COUNT(*) as total_tracking_events,
          SUM(CASE WHEN order_type = 'active' THEN 1 ELSE 0 END) as active_events,
          SUM(CASE WHEN order_type = 'inactive' THEN 1 ELSE 0 END) as inactive_events,
          COUNT(DISTINCT CASE WHEN order_type = 'active' THEN order_id END) as active_orders,
          COUNT(DISTINCT CASE WHEN order_type = 'inactive' THEN order_id END) as inactive_orders
        FROM order_tracking
      `);
      
      return stats[0];
    } catch (error) {
      console.error('Error getting tracking statistics:', error);
      throw error;
    }
  }

  // ==================== LABELS TABLE METHODS ====================

  /**
   * Update labels table with current shipment status and handover logic
   * @param {string} orderId - The order ID
   * @param {string} accountCode - The account_code for the store (REQUIRED)
   * @param {string} currentStatus - Current shipment status
   * @param {boolean} isHandover - Whether this order is handed over
   * @param {string|null} handoverTimestamp - Timestamp when order became "In Transit" (from tracking API)
   */
  async updateLabelsShipmentStatus(orderId, accountCode, currentStatus, isHandover = false, handoverTimestamp = null) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!accountCode) {
      throw new Error('account_code is required for updating labels shipment status');
    }

    try {
      // Check if label exists for this order and account_code (store isolation)
      const [existingLabels] = await this.mysqlConnection.execute(
        'SELECT id, is_handover, handover_at FROM labels WHERE order_id = ? AND account_code = ?',
        [orderId, accountCode]
      );

      if (existingLabels.length === 0) {
        console.log(`⚠️ No label found for order ${orderId} (${accountCode}), skipping labels update`);
        return;
      }

      const currentHandoverStatus = existingLabels[0].is_handover;
      const existingHandoverAt = existingLabels[0].handover_at;

      // Update current_shipment_status and potentially is_handover
      let updateQuery = `
        UPDATE labels 
        SET current_shipment_status = ?
      `;
      let queryParams = [currentStatus];

      // Only update is_handover if it's currently 0 and we're setting it to 1
      // This ensures is_handover can only go from 0 to 1, never back to 0
      let handoverJustSet = false;
      if (isHandover && currentHandoverStatus === 0) {
        updateQuery += `, is_handover = 1`;
        handoverJustSet = true;
        
        // Set handover_at timestamp ONLY if it doesn't already exist (first "In Transit" event)
        if (!existingHandoverAt) {
          if (handoverTimestamp) {
            updateQuery += `, handover_at = ?`;
            queryParams.push(handoverTimestamp);
            console.log(`🚚 Setting is_handover = 1 and handover_at = ${handoverTimestamp} for order ${orderId} (${accountCode})`);
          } else {
            // If no timestamp provided, use current time
            updateQuery += `, handover_at = NOW()`;
            console.log(`🚚 Setting is_handover = 1 and handover_at = NOW() for order ${orderId} (${accountCode})`);
          }
        } else {
          console.log(`🚚 Order ${orderId} (${accountCode}) already has handover_at = ${existingHandoverAt}, preserving original timestamp`);
        }
        
        console.log(`🚚 Order ${orderId} (${accountCode}) status changed to In Transit (handed over)`);
      }

      updateQuery += ` WHERE order_id = ? AND account_code = ?`;
      queryParams.push(orderId, accountCode);

      await this.mysqlConnection.execute(updateQuery, queryParams);
      
      console.log(`✅ Updated labels table for order ${orderId} (${accountCode}): status=${currentStatus}, handover=${isHandover ? '1' : 'unchanged'}`);
      
    } catch (error) {
      console.error(`❌ Error updating labels table for order ${orderId} (${accountCode}):`, error);
      throw error;
    }
  }

  /**
   * Validate handover/tracking logic - checks which orders should be in handover vs tracking tab
   * This is called hourly along with current_shipment_status updates
   * @returns {Object} Summary of validation results
   */
  async validateHandoverTrackingLogic() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      console.log('🔍 [Handover/Tracking Validation] Starting validation check...');
      
      // Get all orders with handover_at timestamp and is_manifest = 1 (grouped by account_code for store isolation)
      const [orders] = await this.mysqlConnection.execute(`
        SELECT 
          l.order_id,
          l.handover_at,
          l.is_manifest,
          TIMESTAMPDIFF(HOUR, l.handover_at, NOW()) as hours_since_handover,
          CASE 
            WHEN l.handover_at IS NULL THEN 'handover'
            WHEN TIMESTAMPDIFF(HOUR, l.handover_at, NOW()) < 24 THEN 'handover'
            WHEN TIMESTAMPDIFF(HOUR, l.handover_at, NOW()) >= 24 THEN 'tracking'
            ELSE 'unknown'
          END as expected_tab
        FROM labels l
        INNER JOIN orders o ON o.order_id = l.order_id AND o.account_code = l.account_code
        INNER JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
        WHERE l.is_manifest = 1
        AND (l.handover_at IS NOT NULL OR c.status IN ('claimed', 'ready_for_handover'))
        ORDER BY l.handover_at DESC
      `);

      const handoverOrders = orders.filter(o => o.expected_tab === 'handover');
      const trackingOrders = orders.filter(o => o.expected_tab === 'tracking');
      const ordersWithoutHandover = orders.filter(o => o.handover_at === null);

      console.log(`📊 [Handover/Tracking Validation] Validation Summary:`);
      console.log(`   - Total orders checked: ${orders.length}`);
      console.log(`   - Orders in Handover tab: ${handoverOrders.length} (handover_at IS NULL or < 24 hours)`);
      console.log(`   - Orders in Tracking tab: ${trackingOrders.length} (handover_at >= 24 hours)`);
      console.log(`   - Orders without handover_at: ${ordersWithoutHandover.length}`);

      // Log orders that are close to the 24-hour threshold (within 1 hour)
      const nearThreshold = orders.filter(o => 
        o.handover_at !== null && 
        o.hours_since_handover >= 23 && 
        o.hours_since_handover < 24
      );
      
      if (nearThreshold.length > 0) {
        console.log(`⚠️ [Handover/Tracking Validation] ${nearThreshold.length} order(s) approaching 24-hour threshold:`);
        nearThreshold.forEach(order => {
          console.log(`   - Order ${order.order_id}: ${order.hours_since_handover.toFixed(1)} hours since handover (will move to tracking soon)`);
        });
      }

      // Log orders that just crossed the 24-hour threshold (within last hour)
      const justCrossed = orders.filter(o => 
        o.handover_at !== null && 
        o.hours_since_handover >= 24 && 
        o.hours_since_handover < 25
      );
      
      if (justCrossed.length > 0) {
        console.log(`🔄 [Handover/Tracking Validation] ${justCrossed.length} order(s) recently moved to tracking tab:`);
        justCrossed.forEach(order => {
          console.log(`   - Order ${order.order_id}: ${order.hours_since_handover.toFixed(1)} hours since handover (now in tracking)`);
        });
      }

      return {
        success: true,
        totalOrders: orders.length,
        handoverTab: handoverOrders.length,
        trackingTab: trackingOrders.length,
        withoutHandover: ordersWithoutHandover.length,
        nearThreshold: nearThreshold.length,
        justCrossed: justCrossed.length,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ [Handover/Tracking Validation] Validation failed:', error);
      throw error;
    }
  }

  /**
   * Get labels with their current shipment status
   */
  async getLabelsWithShipmentStatus() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          l.order_id,
          l.label_url,
          l.awb,
          l.carrier_name,
          l.is_handover,
          l.current_shipment_status,
          l.created_at,
          l.updated_at,
          o.customer_name,
          o.product_name
        FROM labels l
        LEFT JOIN orders o ON l.order_id = o.order_id AND l.account_code = o.account_code
        ORDER BY l.updated_at DESC
      `);
      
      return rows;
    } catch (error) {
      console.error('Error getting labels with shipment status:', error);
      throw error;
    }
  }

  /**
   * Get labels that are handed over (is_handover = 1)
   */
  async getHandedOverLabels() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(`
        SELECT 
          l.order_id,
          l.label_url,
          l.awb,
          l.carrier_name,
          l.current_shipment_status,
          l.handover_at,
          l.updated_at,
          o.customer_name,
          o.product_name
        FROM labels l
        LEFT JOIN orders o ON l.order_id = o.order_id AND l.account_code = o.account_code
        WHERE l.is_handover = 1
        ORDER BY l.updated_at DESC
      `);
      
      return rows;
    } catch (error) {
      console.error('Error getting handed over labels:', error);
      throw error;
    }
  }

  // ============================================================================
  // STORE MANAGEMENT METHODS (Multi-Store Feature)
  // ============================================================================

  /**
   * Create store_info table if it doesn't exist
   */
  async createStoreInfoTable() {
    if (!this.mysqlConnection) return;

    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS store_info (
          id INT AUTO_INCREMENT PRIMARY KEY,
          account_code VARCHAR(50) UNIQUE NOT NULL,
          store_name VARCHAR(255) NOT NULL,
          shipping_partner VARCHAR(255) NOT NULL,
          username VARCHAR(255) NOT NULL,
          password_encrypted TEXT NOT NULL,
          auth_token TEXT NOT NULL,
          shopify_store_url VARCHAR(255) NOT NULL,
          shopify_token TEXT NOT NULL,
          status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          created_by VARCHAR(50),
          last_synced_at TIMESTAMP NULL,
          last_shopify_sync_at TIMESTAMP NULL,
          INDEX idx_status (status),
          INDEX idx_account_code (account_code),
          INDEX idx_shipping_partner (shipping_partner)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ store_info table created/verified');
    } catch (error) {
      console.error('❌ Error creating store_info table:', error.message);
    }
  }

  /**
   * Create wh_mapping table if it doesn't exist
   * Maps claimio_wh_id (internal warehouse ID) to vendor_wh_id (shipping partner warehouse ID) per account_code
   */
  async createWhMappingTable() {
    if (!this.mysqlConnection) return;

    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS wh_mapping (
          id INT AUTO_INCREMENT PRIMARY KEY,
          claimio_wh_id VARCHAR(50) NOT NULL,
          vendor_wh_id VARCHAR(50) NOT NULL,
          account_code VARCHAR(50) NOT NULL,
          return_warehouse_id VARCHAR(50),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_claimio_wh_id (claimio_wh_id),
          INDEX idx_account_code (account_code),
          INDEX idx_is_active (is_active),
          INDEX idx_claimio_account (claimio_wh_id, account_code),
          FOREIGN KEY (account_code) REFERENCES store_info(account_code) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ wh_mapping table created/verified');
      
      // Add return_warehouse_id column if it doesn't exist (migration)
      try {
        const [columns] = await this.mysqlConnection.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'wh_mapping' 
          AND COLUMN_NAME = 'return_warehouse_id'
        `);
        
        if (columns.length === 0) {
          await this.mysqlConnection.execute(`
            ALTER TABLE wh_mapping 
            ADD COLUMN return_warehouse_id VARCHAR(50) AFTER account_code
          `);
          console.log('✅ Added return_warehouse_id column to wh_mapping table');
        }
      } catch (migrationError) {
        console.error('⚠️ Error adding return_warehouse_id column (may already exist):', migrationError.message);
      }
    } catch (error) {
      console.error('❌ Error creating wh_mapping table:', error.message);
    }
  }

  /**
   * Get store by account_code
   * @param {string} accountCode - The account code to search for
   * @returns {Object|null} Store object or null if not found
   */
  async getStoreByAccountCode(accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM store_info WHERE account_code = ?',
        [accountCode]
      );
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting store by account code:', error);
      throw error;
    }
  }

  /**
   * Get multiple stores by account_codes (bulk fetch)
   * OPTIMIZATION: Fetches all stores in one query instead of N queries
   * @param {Array<string>} account_codes - Array of account codes
   * @returns {Array} Array of store objects
   */
  async getStoresByAccountCodes(account_codes) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!account_codes || !Array.isArray(account_codes) || account_codes.length === 0) {
      return [];
    }

    try {
      const placeholders = account_codes.map(() => '?').join(',');
      
      const [rows] = await this.mysqlConnection.execute(
        `SELECT * FROM store_info WHERE account_code IN (${placeholders})`,
        account_codes
      );
      
      return rows || [];
    } catch (error) {
      console.error('Error getting stores by account_codes:', error);
      throw new Error('Failed to get stores from database');
    }
  }

  /**
   * Get store by Shopify URL or token
   * @param {string} shopifyUrl - The Shopify store URL (e.g., 'seq5t1-mz.myshopify.com')
   * @param {string} shopifyToken - The Shopify access token (optional, used as fallback)
   * @returns {Object|null} Store object or null if not found
   */
  async getStoreByShopifyCredentials(shopifyUrl, shopifyToken = null) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Extract store domain from URL if full URL is provided
      let storeDomain = shopifyUrl;
      if (shopifyUrl.includes('://')) {
        // Extract domain from full URL (e.g., 'https://seq5t1-mz.myshopify.com/admin/api/...')
        const urlMatch = shopifyUrl.match(/https?:\/\/([^\/]+)/);
        if (urlMatch) {
          storeDomain = urlMatch[1];
        }
      }
      
      // Remove 'admin/api' part if present and clean up
      storeDomain = storeDomain.split('/')[0].trim();
      
      // Remove protocol if still present
      storeDomain = storeDomain.replace(/^https?:\/\//, '');
      
      console.log(`🔍 [Store Lookup] Searching for store with domain: ${storeDomain}`);
      
      // Try exact match first (ACTIVE stores only)
      let [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM store_info WHERE shopify_store_url = ? AND status = "active"',
        [storeDomain]
      );
      
      // Try with https:// prefix
      if (rows.length === 0) {
        [rows] = await this.mysqlConnection.execute(
          'SELECT * FROM store_info WHERE shopify_store_url = ? AND status = "active"',
          [`https://${storeDomain}`]
        );
      }
      
      // Try with http:// prefix
      if (rows.length === 0) {
        [rows] = await this.mysqlConnection.execute(
          'SELECT * FROM store_info WHERE shopify_store_url = ? AND status = "active"',
          [`http://${storeDomain}`]
        );
      }
      
      // Try partial match (LIKE)
      if (rows.length === 0) {
        [rows] = await this.mysqlConnection.execute(
          'SELECT * FROM store_info WHERE shopify_store_url LIKE ? AND status = "active"',
          [`%${storeDomain}%`]
        );
      }
      
      // If still not found and token is provided, try to find by token (ACTIVE stores only)
      if (rows.length === 0 && shopifyToken) {
        console.log(`🔍 [Store Lookup] Trying to find store by Shopify token...`);
        [rows] = await this.mysqlConnection.execute(
          'SELECT * FROM store_info WHERE shopify_token = ? AND status = "active"',
          [shopifyToken]
        );
      }
      
      if (rows.length > 0) {
        console.log(`✅ [Store Lookup] Found store: ${rows[0].store_name} (account_code: ${rows[0].account_code})`);
        return rows[0];
      } else {
        // Log all available stores for debugging
        try {
          const [allStores] = await this.mysqlConnection.execute(
            'SELECT account_code, store_name, shopify_store_url, status FROM store_info'
          );
          console.log(`❌ [Store Lookup] Store not found. Searched domain: "${storeDomain}", Token provided: ${shopifyToken ? 'Yes' : 'No'}`);
          if (allStores.length === 0) {
            console.log(`   ⚠️ No stores found in store_info table. Please add a store first.`);
          } else {
            console.log(`   Available stores in database (${allStores.length}):`);
            allStores.forEach(store => {
              console.log(`     - ${store.store_name} (${store.account_code}): "${store.shopify_store_url}" [${store.status}]`);
            });
            console.log(`   💡 Tip: Make sure shopify_store_url matches the domain "${storeDomain}" or use the Shopify token to match.`);
          }
        } catch (logError) {
          console.error(`❌ [Store Lookup] Error fetching store list for debugging:`, logError.message);
        }
        return null;
      }
    } catch (error) {
      console.error('Error getting store by Shopify credentials:', error);
      throw error;
    }
  }

  /**
   * Get all stores
   * @returns {Array} Array of store objects
   */
  async getAllStores() {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM store_info ORDER BY created_at DESC'
      );
      
      return rows;
    } catch (error) {
      console.error('Error getting all stores:', error);
      throw error;
    }
  }

  /**
   * Get stores by status
   * @param {string} status - 'active' or 'inactive'
   * @returns {Array} Array of store objects
   */
  async getStoresByStatus(status) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM store_info WHERE status = ? ORDER BY store_name ASC',
        [status]
      );
      
      return rows;
    } catch (error) {
      console.error('Error getting stores by status:', error);
      throw error;
    }
  }

  /**
   * Get all active stores
   * @returns {Array} Array of active store objects
   */
  async getActiveStores() {
    return this.getStoresByStatus('active');
  }

  /**
   * Update store last sync timestamp
   * @param {string} accountCode - The account code
   */
  async updateStoreLastSync(accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      await this.mysqlConnection.execute(
        'UPDATE store_info SET last_synced_at = NOW() WHERE account_code = ?',
        [accountCode]
      );
    } catch (error) {
      console.error('Error updating store last sync:', error);
      throw error;
    }
  }

  /**
   * Update store Shopify sync timestamp
   * @param {string} accountCode - The account code
   */
  async updateStoreShopifySync(accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      await this.mysqlConnection.execute(
        'UPDATE store_info SET last_shopify_sync_at = NOW() WHERE account_code = ?',
        [accountCode]
      );
    } catch (error) {
      console.error('Error updating store Shopify sync:', error);
      throw error;
    }
  }

  /**
   * Create a new store
   * @param {Object} storeData - Store data object
   * @returns {Object} Result object
   */
  async createStore(storeData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      await this.mysqlConnection.execute(
        `INSERT INTO store_info (
          account_code,
          store_name,
          shipping_partner,
          username,
          password_encrypted,
          auth_token,
          shopify_store_url,
          shopify_token,
          status,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          storeData.account_code,
          storeData.store_name,
          storeData.shipping_partner,
          storeData.username,
          storeData.password_encrypted,
          storeData.auth_token,
          storeData.shopify_store_url,
          storeData.shopify_token,
          storeData.status,
          storeData.created_by
        ]
      );

      return { success: true };
    } catch (error) {
      console.error('Error creating store:', error);
      throw error;
    }
  }

  /**
   * Update store
   * @param {string} accountCode - The account code
   * @param {Object} updateData - Data to update
   * @returns {Object} Result object
   */
  async updateStore(accountCode, updateData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const fields = [];
      const values = [];

      // Build dynamic update query based on provided fields
      if (updateData.store_name !== undefined) {
        fields.push('store_name = ?');
        values.push(updateData.store_name);
      }
      if (updateData.username !== undefined) {
        fields.push('username = ?');
        values.push(updateData.username);
      }
      if (updateData.password_encrypted !== undefined) {
        fields.push('password_encrypted = ?');
        values.push(updateData.password_encrypted);
      }
      if (updateData.auth_token !== undefined) {
        fields.push('auth_token = ?');
        values.push(updateData.auth_token);
      }
      if (updateData.shopify_store_url !== undefined) {
        fields.push('shopify_store_url = ?');
        values.push(updateData.shopify_store_url);
      }
      if (updateData.shopify_token !== undefined) {
        fields.push('shopify_token = ?');
        values.push(updateData.shopify_token);
      }
      if (updateData.status !== undefined) {
        fields.push('status = ?');
        values.push(updateData.status);
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      values.push(accountCode);

      await this.mysqlConnection.execute(
        `UPDATE store_info SET ${fields.join(', ')} WHERE account_code = ?`,
        values
      );

      return { success: true };
    } catch (error) {
      console.error('Error updating store:', error);
      throw error;
    }
  }

  /**
   * Delete store (soft delete by setting status to inactive)
   * @param {string} accountCode - The account code
   * @returns {Object} Result object
   */
  async deleteStore(accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      await this.mysqlConnection.execute(
        'UPDATE store_info SET status = ? WHERE account_code = ?',
        ['inactive', accountCode]
      );

      return { success: true };
    } catch (error) {
      console.error('Error deleting store:', error);
      throw error;
    }
  }

  /**
   * Get vendor warehouse ID from mapping by claimio warehouse ID and account code
   * @param {string} claimioWhId - The claimio warehouse ID (from users.warehouseId)
   * @param {string} accountCode - The account code (store identifier)
   * @returns {Promise<string|null>} vendor_wh_id or null if not found
   */
  async getVendorWhIdByClaimioWhIdAndAccountCode(claimioWhId, accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT vendor_wh_id FROM wh_mapping WHERE claimio_wh_id = ? AND account_code = ? AND is_active = TRUE LIMIT 1',
        [claimioWhId, accountCode]
      );
      return rows.length > 0 ? rows[0].vendor_wh_id : null;
    } catch (error) {
      console.error('Error getting vendor warehouse ID from mapping:', error);
      throw new Error('Failed to get vendor warehouse ID from database');
    }
  }

  /**
   * Get warehouse mapping details (vendor_wh_id and return_warehouse_id) by claimio warehouse ID and account code
   * @param {string} claimioWhId - The claimio warehouse ID (from users.warehouseId)
   * @param {string} accountCode - The account code (store identifier)
   * @returns {Promise<Object|null>} Object with vendor_wh_id and return_warehouse_id, or null if not found
   */
  async getWhMappingByClaimioWhIdAndAccountCode(claimioWhId, accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT vendor_wh_id, return_warehouse_id FROM wh_mapping WHERE claimio_wh_id = ? AND account_code = ? AND is_active = TRUE LIMIT 1',
        [claimioWhId, accountCode]
      );
      return rows.length > 0 ? { vendor_wh_id: rows[0].vendor_wh_id, return_warehouse_id: rows[0].return_warehouse_id } : null;
    } catch (error) {
      console.error('Error getting warehouse mapping:', error);
      throw new Error('Failed to get warehouse mapping from database');
    }
  }

  /**
   * Get multiple warehouse mappings by claimio_wh_id and account_codes (bulk fetch)
   * OPTIMIZATION: Fetches all mappings in one query instead of N queries
   * @param {string} claimioWhId - The claimio warehouse ID
   * @param {Array<string>} account_codes - Array of account codes
   * @returns {Array} Array of mapping objects with account_code
   */
  async getWhMappingsByClaimioWhIdAndAccountCodes(claimioWhId, account_codes) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    if (!claimioWhId || !account_codes || !Array.isArray(account_codes) || account_codes.length === 0) {
      return [];
    }

    try {
      const placeholders = account_codes.map(() => '?').join(',');
      
      const [rows] = await this.mysqlConnection.execute(
        `SELECT vendor_wh_id, return_warehouse_id, account_code 
         FROM wh_mapping 
         WHERE claimio_wh_id = ? AND account_code IN (${placeholders}) AND is_active = TRUE`,
        [claimioWhId, ...account_codes]
      );
      
      return rows || [];
    } catch (error) {
      console.error('Error getting warehouse mappings:', error);
      throw new Error('Failed to get warehouse mappings from database');
    }
  }

  /**
   * Get all warehouse mappings (for admin display)
   * @param {boolean} includeInactive - Whether to include inactive mappings
   * @returns {Promise<Array>} Array of mapping objects
   */
  async getAllWhMappings(includeInactive = true) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      let query = `
        SELECT 
          wm.id,
          wm.claimio_wh_id,
          wm.vendor_wh_id,
          wm.account_code,
          wm.return_warehouse_id,
          wm.is_active,
          wm.created_at,
          wm.modified_at,
          u.name as vendor_name,
          s.store_name
        FROM wh_mapping wm
        LEFT JOIN users u ON wm.claimio_wh_id = u.warehouseId
        LEFT JOIN store_info s ON wm.account_code = s.account_code
      `;
      
      if (!includeInactive) {
        query += ' WHERE wm.is_active = TRUE';
      }
      
      query += ' ORDER BY wm.created_at DESC';
      
      const [rows] = await this.mysqlConnection.execute(query);
      return rows;
    } catch (error) {
      console.error('Error getting warehouse mappings:', error);
      throw new Error('Failed to get warehouse mappings from database');
    }
  }

  /**
   * Get warehouse mapping by ID
   * @param {number} id - Mapping ID
   * @returns {Promise<Object|null>} Mapping object or null if not found
   */
  async getWhMappingById(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        `SELECT 
          wm.id,
          wm.claimio_wh_id,
          wm.vendor_wh_id,
          wm.account_code,
          wm.return_warehouse_id,
          wm.is_active,
          wm.created_at,
          wm.modified_at,
          u.name as vendor_name,
          s.store_name
        FROM wh_mapping wm
        LEFT JOIN users u ON wm.claimio_wh_id = u.warehouseId
        LEFT JOIN store_info s ON wm.account_code = s.account_code
        WHERE wm.id = ?`,
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting warehouse mapping by ID:', error);
      throw new Error('Failed to get warehouse mapping from database');
    }
  }

  /**
   * Check if active mapping exists for claimio_wh_id and account_code
   * @param {string} claimioWhId - The claimio warehouse ID
   * @param {string} accountCode - The account code
   * @returns {Promise<boolean>} True if active mapping exists
   */
  async activeWhMappingExists(claimioWhId, accountCode) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT id FROM wh_mapping WHERE claimio_wh_id = ? AND account_code = ? AND is_active = TRUE LIMIT 1',
        [claimioWhId, accountCode]
      );
      return rows.length > 0;
    } catch (error) {
      console.error('Error checking warehouse mapping existence:', error);
      throw new Error('Failed to check warehouse mapping in database');
    }
  }

  /**
   * Create warehouse mapping
   * @param {Object} mappingData - Mapping data
   * @param {string} mappingData.claimio_wh_id - Claimio warehouse ID
   * @param {string} mappingData.vendor_wh_id - Vendor warehouse ID (shipping partner)
   * @param {string} mappingData.account_code - Account code
   * @returns {Promise<Object>} Created mapping object
   */
  async createWhMapping(mappingData) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      // Check if active mapping already exists
      const exists = await this.activeWhMappingExists(mappingData.claimio_wh_id, mappingData.account_code);
      if (exists) {
        throw new Error('Active mapping already exists for this claimio_wh_id and account_code combination');
      }

      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO wh_mapping (claimio_wh_id, vendor_wh_id, account_code, return_warehouse_id, is_active) VALUES (?, ?, ?, ?, TRUE)',
        [mappingData.claimio_wh_id, mappingData.vendor_wh_id, mappingData.account_code, mappingData.return_warehouse_id || null]
      );

      return await this.getWhMappingById(result.insertId);
    } catch (error) {
      console.error('Error creating warehouse mapping:', error);
      throw error;
    }
  }

  /**
   * Soft delete warehouse mapping (set is_active = FALSE)
   * @param {number} id - Mapping ID
   * @returns {Promise<boolean>} True if updated successfully
   */
  async deleteWhMapping(id) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [result] = await this.mysqlConnection.execute(
        'UPDATE wh_mapping SET is_active = FALSE, modified_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting warehouse mapping:', error);
      throw new Error('Failed to delete warehouse mapping from database');
    }
  }

}

module.exports = new Database(); 
