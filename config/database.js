const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

/**
 * Database Configuration and Utilities
 * Handles all database operations using MySQL
 */
class Database {
  constructor() {
    this.mysqlConnection = null; // Keep for backward compatibility
    this.mysqlPool = null; // Connection pool
    this.mysqlInitialized = false;
    this.initializing = false;
    // Don't auto-initialize in serverless environment
    if (process.env.NODE_ENV !== 'production' || process.env.FORCE_DB_INIT === 'true') {
    this.initializeMySQL();
    }
  }

  /**
   * Initialize MySQL connection
   */
  async initializeMySQL() {
    // Prevent multiple simultaneous initializations
    if (this.initializing) {
      console.log('⏳ Database initialization already in progress, waiting...');
      while (this.initializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    if (this.mysqlInitialized && this.mysqlConnection) {
      console.log('✅ Database already initialized');
      return;
    }

    this.initializing = true;
    try {
      // Get database configuration from environment variables
      // Support both standard DB_* and MYSQL_* variable formats, plus URL parsing
      let dbConfig = {
        host: process.env.DB_HOST || process.env.MYSQL_HOST || process.env.MYSQLHOST,
        user: process.env.DB_USER || process.env.MYSQL_USER || process.env.MYSQLUSER,
        password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD,
        database: process.env.DB_NAME || process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE,
        port: process.env.DB_PORT || process.env.MYSQL_PORT || process.env.MYSQLPORT || 3306
      };

      // If MYSQL_URL is provided, parse it and override individual settings
      if (process.env.MYSQL_URL) {
        try {
          const url = new URL(process.env.MYSQL_URL);
          dbConfig.host = url.hostname;
          dbConfig.port = url.port || 3306;
          dbConfig.user = url.username;
          dbConfig.password = url.password;
          dbConfig.database = url.pathname.substring(1); // Remove leading slash
          console.log('✅ Parsed database configuration from MYSQL_URL');
          console.log('🔍 Connection details:', {
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            database: dbConfig.database,
            hasPassword: !!dbConfig.password
          });
        } catch (error) {
          console.error('❌ Error parsing MYSQL_URL:', error.message);
          throw new Error('Invalid MYSQL_URL format');
        }
      }

      // Log connection details for debugging
      const sslConfig = process.env.NODE_ENV === 'production' || process.env.DB_HOST?.includes('railway') || process.env.DB_HOST?.includes('rlwy') ? { rejectUnauthorized: false } : false;
      console.log('🔍 Attempting to connect with:', {
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        database: dbConfig.database,
        hasPassword: !!dbConfig.password,
        ssl: sslConfig,
        isRailway: dbConfig.host?.includes('railway') || dbConfig.host?.includes('rlwy')
      });

      // Validate required environment variables
      if (!dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database) {
        throw new Error('Missing required database environment variables: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
      }

      // Railway-specific connection configuration
      const isRailway = dbConfig.host?.includes('railway') || dbConfig.host?.includes('rlwy');
      
      // Connection Pool Configuration (Better for serverless!)
      const poolConfig = {
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        port: dbConfig.port,
        database: dbConfig.database,
        ssl: isRailway ? { rejectUnauthorized: false } : false,
        
        // Connection Pool Settings
        connectionLimit: 5, // Max 5 connections in pool
        queueLimit: 0, // Unlimited queue
        waitForConnections: true,
        
        // Timeouts
        connectTimeout: 30000,
        acquireTimeout: 30000,
        
        // Keep connections alive (NO auto-close)
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000, // Send keepalive every 10s to prevent timeout
        
        // Railway-specific settings
        ...(isRailway && {
          charset: 'utf8mb4',
          timezone: '+00:00',
          multipleStatements: false
        })
      };

      // Create connection pool with retry logic
      let retries = 3;
      let lastError;
      
      while (retries > 0) {
        try {
          console.log(`🔄 Creating connection pool (${4 - retries}/3)...`);
          
          // Create connection pool
          this.mysqlPool = mysql.createPool(poolConfig);
          
          // Add connection error handlers
          this.mysqlPool.on('connection', (connection) => {
            console.log('🔌 New connection established in pool');
            
            // Handle connection errors
            connection.on('error', (err) => {
              console.error('❌ Connection error in pool:', err.message);
              if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
                console.log('🔄 Connection lost, pool will create new one automatically');
              }
            });
          });
          
          // Test the pool by getting a connection
          const connection = await this.mysqlPool.getConnection();
          await connection.execute('SELECT 1');
          connection.release();
          
          console.log('✅ MySQL connection pool established');
          
          // For backward compatibility, keep a reference
          this.mysqlConnection = this.mysqlPool;
          
          // Create tables
      await this.createCarriersTable();
      await this.createProductsTable();
      await this.createUsersTable();
      await this.createSettlementsTable();
      await this.createTransactionsTable();
      await this.createOrdersTable();
      await this.createClaimsTable();
          
      this.mysqlInitialized = true;
          this.initializing = false;
          return; // Success, exit retry loop
          
    } catch (error) {
          lastError = error;
          retries--;
          console.error(`❌ Connection pool creation failed (${retries} retries left):`, error.message);
          
          if (retries > 0) {
            console.log('⏳ Waiting 2 seconds before retry...');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      // All retries failed
      this.initializing = false;
      throw lastError;
      
    } catch (error) {
      console.error('❌ MySQL connection failed after all retries:', error.message);
      console.error('🔍 Error details:', {
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState
      });
      
      // MySQL connection failed - application will not function without database
      this.mysqlConnection = null;
      this.mysqlInitialized = true; // Mark as initialized even if failed
      this.initializing = false;
      throw new Error(`Database initialization failed: ${error.message}`);
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
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Carriers table created/verified');
    } catch (error) {
      console.error('❌ Error creating carriers table:', error.message);
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
          sku_id VARCHAR(100)
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
    } catch (error) {
      console.error('❌ Error creating products table:', error.message);
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
      // Drop existing orders table to recreate with clean structure
      console.log('🔄 Dropping existing orders table and creating fresh one...');
      await this.mysqlConnection.execute('DROP TABLE IF EXISTS orders');
      console.log('✅ Old orders table dropped');

      const createTableQuery = `
        CREATE TABLE orders (
          id VARCHAR(50) PRIMARY KEY,
          unique_id VARCHAR(100) UNIQUE,
          order_id VARCHAR(100),
          customer_name VARCHAR(255),
          order_date DATETIME,
          product_name VARCHAR(500),
          product_code VARCHAR(100),
          selling_price DECIMAL(10,2),
          order_total DECIMAL(10,2),
          payment_type VARCHAR(50),
          prepaid_amount DECIMAL(10,2),
          order_total_ratio DECIMAL(10,2),
          order_total_split DECIMAL(10,2),
          collectable_amount DECIMAL(10,2),
          pincode VARCHAR(20),
          is_in_new_order BOOLEAN DEFAULT 1,
          INDEX idx_unique_id (unique_id),
          INDEX idx_order_id (order_id),
          INDEX idx_pincode (pincode),
          INDEX idx_order_date (order_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createTableQuery);
      console.log('✅ Fresh orders table created with clean structure');

      // Create labels table for caching label URLs
      await this.createLabelsTable();
    } catch (error) {
      console.error('❌ Error creating orders table:', error.message);
    }
  }

  /**
   * Create labels table for caching label URLs
   */
  async createLabelsTable() {
    try {
      // Drop existing labels table to recreate with clean structure
      console.log('🔄 Dropping existing labels table and creating fresh one...');
      await this.mysqlConnection.execute('DROP TABLE IF EXISTS labels');
      console.log('✅ Old labels table dropped');

      const createLabelsTableQuery = `
        CREATE TABLE labels (
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
          INDEX idx_order_id (order_id),
          INDEX idx_awb (awb),
          INDEX idx_carrier_id (carrier_id),
          INDEX idx_priority_carrier (priority_carrier),
          INDEX idx_is_manifest (is_manifest)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createLabelsTableQuery);
      console.log('✅ Fresh labels table created with clean structure');
      
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
      
      // Migrate existing labels data from orders table
      await this.migrateLabelsData();
      } catch (error) {
      console.error('❌ Error creating labels table:', error.message);
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
          INDEX idx_order_unique_id (order_unique_id),
          INDEX idx_order_id (order_id),
          INDEX idx_claimed_by (claimed_by),
          INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      
      await this.mysqlConnection.execute(createClaimsTableQuery);
      console.log('✅ Claims table created/verified');
      
      // Migrate existing claims data from orders table if claims table is empty
      await this.migrateClaimsData();
    } catch (error) {
      console.error('❌ Error creating claims table:', error.message);
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
        'SELECT * FROM carriers ORDER BY priority ASC'
      );
      return rows;
    } catch (error) {
      console.error('Error getting all carriers:', error);
      throw new Error('Failed to get carriers from database');
    }
  }

  /**
   * Get carrier by carrier_id
   * @param {string} carrierId - Carrier ID
   * @returns {Promise<Object|null>} Carrier object or null if not found
   */
  async getCarrierById(carrierId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM carriers WHERE carrier_id = ?',
        [carrierId]
      );
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
      const { carrier_id, carrier_name, status, weight_in_kg, priority } = carrierData;
      
      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO carriers (carrier_id, carrier_name, status, weight_in_kg, priority) VALUES (?, ?, ?, ?, ?)',
        [carrier_id, carrier_name, status || 'Active', weight_in_kg || null, priority]
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
  async updateCarrier(carrierId, updateData) {
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

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      values.push(carrierId);

      const [result] = await this.mysqlConnection.execute(
        `UPDATE carriers SET ${fields.join(', ')} WHERE carrier_id = ?`,
        values
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return await this.getCarrierById(carrierId);
    } catch (error) {
      console.error('Error updating carrier:', error);
      throw new Error('Failed to update carrier in database');
    }
  }

  /**
   * Delete carrier
   * @param {string} carrierId - Carrier ID
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteCarrier(carrierId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [result] = await this.mysqlConnection.execute(
        'DELETE FROM carriers WHERE carrier_id = ?',
        [carrierId]
      );

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
        const existing = await this.getCarrierById(carrier.carrier_id);
        
        if (existing) {
          await this.updateCarrier(carrier.carrier_id, carrier);
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
      const { id, name, image, altText, totalImages } = productData;
      
      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO products (id, name, image, altText, totalImages) VALUES (?, ?, ?, ?, ?)',
        [id, name, image || null, altText || null, totalImages || 0]
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
      
      const [result] = await this.mysqlConnection.execute(
        'INSERT INTO users (id, name, email, phone, password, role, status, token, active_session, contactNumber, warehouseId, address, city, pincode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, name, email, phone || null, password || null, role, status || 'active', token || null, active_session || null, contactNumber || null, warehouseId || null, address || null, city || null, pincode || null]
      );

      return {
        id,
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

    try {
      // Use INSERT ... ON DUPLICATE KEY UPDATE for orders table
      await this.mysqlConnection.execute(
        `INSERT INTO orders (
          id, unique_id, order_id, customer_name, order_date,
          product_name, product_code, selling_price, order_total, payment_type,
          prepaid_amount, order_total_ratio, order_total_split, collectable_amount,
          pincode, is_in_new_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          order_date = VALUES(order_date),
          product_name = VALUES(product_name),
          selling_price = VALUES(selling_price),
          order_total = VALUES(order_total),
          payment_type = VALUES(payment_type),
          prepaid_amount = VALUES(prepaid_amount),
          order_total_ratio = VALUES(order_total_ratio),
          order_total_split = VALUES(order_total_split),
          collectable_amount = VALUES(collectable_amount),
          pincode = VALUES(pincode),
          is_in_new_order = VALUES(is_in_new_order)`,
        [
          orderData.id || null,
          orderData.unique_id || null,
          orderData.order_id || null,
          orderData.customer_name || null,
          orderData.order_date || null,
          orderData.product_name || null,
          orderData.product_code || null,
          orderData.selling_price || null,
          orderData.order_total || null,
          orderData.payment_type || null,
          orderData.prepaid_amount || null,
          orderData.order_total_ratio || null,
          orderData.order_total_split || null,
          orderData.collectable_amount || null,
          orderData.pincode || null,
          orderData.is_in_new_order !== undefined ? orderData.is_in_new_order : true
        ]
      );

      // Use INSERT ... ON DUPLICATE KEY UPDATE for claims table
      await this.mysqlConnection.execute(
        `INSERT INTO claims (
          order_unique_id, order_id, status, claimed_by, claimed_at, last_claimed_by, 
          last_claimed_at, clone_status, cloned_order_id, is_cloned_row, label_downloaded
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          order_id = VALUES(order_id)`,
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
          orderData.label_downloaded || false
        ]
      );

      // Use INSERT ... ON DUPLICATE KEY UPDATE for labels table
      await this.mysqlConnection.execute(
        `INSERT INTO labels (
          order_id, handover_at, priority_carrier
        ) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          handover_at = VALUES(handover_at),
          priority_carrier = VALUES(priority_carrier)`,
        [
          orderData.order_id || null,
          orderData.handover_at || null,
          orderData.priority_carrier || null
        ]
      );

      return await this.getOrderByUniqueId(orderData.unique_id);
    } catch (error) {
      console.error('Error creating order:', error);
      throw new Error('Failed to create order');
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
          l.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON TRIM(
          CASE 
            WHEN LOWER(o.product_name) LIKE '%kids%' THEN 
              REGEXP_REPLACE(o.product_name, ' - [0-9]+-[0-9]+$', '')
            ELSE 
              REGEXP_REPLACE(o.product_name, ' - (XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')
          END
        ) = p.name
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id
        LEFT JOIN labels l ON o.order_id = l.order_id
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
          l.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON TRIM(
          CASE 
            WHEN LOWER(o.product_name) LIKE '%kids%' THEN 
              REGEXP_REPLACE(o.product_name, ' - [0-9]+-[0-9]+$', '')
            ELSE 
              REGEXP_REPLACE(o.product_name, ' - (XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')
          END
        ) = p.name
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id
        LEFT JOIN labels l ON o.order_id = l.order_id
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
   * Get all orders from MySQL
   * @returns {Array} Array of all orders
   */
  async getAllOrders() {
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
          l.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON TRIM(
          CASE 
            WHEN LOWER(o.product_name) LIKE '%kids%' THEN 
              REGEXP_REPLACE(o.product_name, ' - [0-9]+-[0-9]+$', '')
            ELSE 
              REGEXP_REPLACE(o.product_name, ' - (XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')
          END
        ) = p.name
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id
        LEFT JOIN labels l ON o.order_id = l.order_id
        WHERE (o.is_in_new_order = 1 OR c.label_downloaded = 1) 
        ORDER BY o.order_date DESC, o.order_id, o.product_name
      `);
      
      return rows;
    } catch (error) {
      console.error('Error getting all orders:', error);
      throw new Error('Failed to get orders from database');
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
          l.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON TRIM(
          CASE 
            WHEN LOWER(o.product_name) LIKE '%kids%' THEN 
              REGEXP_REPLACE(o.product_name, ' - [0-9]+-[0-9]+$', '')
            ELSE 
              REGEXP_REPLACE(o.product_name, ' - (XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')
          END
        ) = p.name
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id
        LEFT JOIN labels l ON o.order_id = l.order_id
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
          l.priority_carrier,
          l.is_manifest
        FROM orders o
        LEFT JOIN products p ON TRIM(
          CASE 
            WHEN LOWER(o.product_name) LIKE '%kids%' THEN 
              REGEXP_REPLACE(o.product_name, ' - [0-9]+-[0-9]+$', '')
            ELSE 
              REGEXP_REPLACE(o.product_name, ' - (XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')
          END
        ) = p.name
        LEFT JOIN claims c ON o.unique_id = c.order_unique_id
        LEFT JOIN labels l ON o.order_id = l.order_id
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
        'payment_type', 'prepaid_amount', 'order_total_ratio', 'order_total_split',
        'collectable_amount', 'pincode', 'is_in_new_order'
      ];

      // Claims table fields
      const allowedClaimFields = [
        'order_id', 'status', 'claimed_by', 'claimed_at', 'last_claimed_by', 'last_claimed_at',
        'clone_status', 'cloned_order_id', 'is_cloned_row', 'label_downloaded'
      ];

      // Labels table fields
      const allowedLabelFields = [
        'label_url', 'awb', 'carrier_name', 'handover_at', 'priority_carrier'
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
        
        if (orderResult.affectedRows === 0) {
        return null;
        }
      }

      // Update claims table if there are claim fields to update
      if (claimFields.length > 0) {
        // First, ensure a claim record exists for this unique_id
        await this.mysqlConnection.execute(`
          INSERT INTO claims (order_unique_id, order_id) 
          SELECT o.unique_id, o.order_id FROM orders o WHERE o.unique_id = ?
          ON DUPLICATE KEY UPDATE order_unique_id = VALUES(order_unique_id)
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

          // Ensure a label record exists for this order_id
          await this.mysqlConnection.execute(`
            INSERT INTO labels (order_id) 
            VALUES (?)
            ON DUPLICATE KEY UPDATE order_id = VALUES(order_id)
          `, [orderId]);

          labelValues.push(orderId);
          await this.mysqlConnection.execute(
            `UPDATE labels SET ${labelFields.join(', ')} WHERE order_id = ?`,
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
         LEFT JOIN products p ON TRIM(
          CASE 
            WHEN LOWER(o.product_name) LIKE '%kids%' THEN 
              REGEXP_REPLACE(o.product_name, ' - [0-9]+-[0-9]+$', '')
            ELSE 
              REGEXP_REPLACE(o.product_name, ' - (XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')
          END
        ) = p.name
         LEFT JOIN claims c ON o.unique_id = c.order_unique_id
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
    return this.mysqlConnection !== null;
  }

  /**
   * Test database connection health
   * @returns {Promise<boolean>} True if connection is healthy
   */
  async testConnection() {
    if (!this.mysqlPool && !this.mysqlConnection) {
      return false;
    }

    try {
      // Use pool if available
      if (this.mysqlPool) {
        const connection = await this.mysqlPool.getConnection();
        
        try {
          await connection.execute('SELECT 1');
          connection.release();
          return true;
        } catch (queryError) {
          // Release connection even on error
          connection.release();
          
          // If connection is lost, pool will automatically create new one
          if (queryError.code === 'PROTOCOL_CONNECTION_LOST' || 
              queryError.code === 'ECONNRESET' ||
              queryError.code === 'ETIMEDOUT') {
            console.log('🔄 Stale connection detected, pool will refresh automatically');
            return false;
          }
          throw queryError;
        }
      }
      
      // Fallback to direct connection
      await this.mysqlConnection.execute('SELECT 1');
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Reconnect to database if connection is lost
   * @returns {Promise<boolean>} True if reconnection successful
   */
  async reconnect() {
    try {
      // Close existing pool/connection
      if (this.mysqlPool) {
        await this.mysqlPool.end();
        this.mysqlPool = null;
      } else if (this.mysqlConnection) {
        await this.mysqlConnection.end();
      }
      
      this.mysqlConnection = null;
      this.mysqlInitialized = false;
      
      // Reinitialize with connection pool
      await this.initializeMySQL();
      return true;
    } catch (error) {
      console.error('Database reconnection failed:', error.message);
      return false;
    }
  }

  /**
   * Get connection pool statistics
   * @returns {Object} Pool statistics
   */
  getPoolStats() {
    if (!this.mysqlPool) {
      return { available: false };
    }

    return {
      available: true,
      totalConnections: this.mysqlPool._allConnections?.length || 0,
      freeConnections: this.mysqlPool._freeConnections?.length || 0,
      queuedRequests: this.mysqlPool._connectionQueue?.length || 0
    };
  }

  /**
   * Labels Table CRUD Operations
   */

  /**
   * Get label by order_id
   * @param {string} orderId - Order ID (can be clone order ID)
   * @returns {Object|null} Label data or null if not found
   */
  async getLabelByOrderId(orderId) {
    if (!this.mysqlConnection) {
      throw new Error('MySQL connection not available');
    }

    try {
      const [rows] = await this.mysqlConnection.execute(
        'SELECT * FROM labels WHERE order_id = ?',
        [orderId]
      );
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
      
      // Always add updated_at
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      
      const updateClause = updateFields.join(', ');
      
      const [result] = await this.mysqlConnection.execute(
        `INSERT INTO labels (order_id, label_url, awb, carrier_id, carrier_name, priority_carrier, is_manifest) 
         VALUES (?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE ${updateClause}`,
        [
          labelData.order_id,
          labelData.label_url || null,
          labelData.awb || null,
          labelData.carrier_id || null,
          labelData.carrier_name || null,
          labelData.priority_carrier || null,
          labelData.is_manifest || 0,
          ...updateValues
        ]
      );

      return await this.getLabelByOrderId(labelData.order_id);
    } catch (error) {
      console.error('Error creating/updating label:', error);
      throw new Error('Failed to save label to database');
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
}

module.exports = new Database(); 