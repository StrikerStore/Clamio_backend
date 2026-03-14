#!/usr/bin/env node

/**
 * Script to extract store credentials from database and generate .env file
 * This helps restore .env file after accidental deletion
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

async function extractCredentials() {
  try {
    // Try to connect to database using Railway defaults or env vars
    const dbConfig = {
      host: process.env.DB_HOST || 'caboose.proxy.rlwy.net',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'AHVfrOOILYWyQcWlToiTQvRCAnkBnCja',
      database: process.env.DB_NAME || 'railway',
      port: parseInt(process.env.DB_PORT) || 12197,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

    console.log('🔍 Connecting to database to extract credentials...');
    console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`   Database: ${dbConfig.database}`);

    const connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database');

    // Get all stores
    const [stores] = await connection.execute(
      'SELECT account_code, store_name, username, shopify_store_url FROM store_info WHERE status = "active" ORDER BY account_code'
    );

    console.log(`\n📊 Found ${stores.length} active stores:`);
    stores.forEach(store => {
      console.log(`   - ${store.store_name} (${store.account_code})`);
      console.log(`     Shipway: ${store.username || 'N/A'}`);
      console.log(`     Shopify: ${store.shopify_store_url || 'N/A'}`);
    });

    // Get first store credentials for .env (legacy support)
    const firstStore = stores.length > 0 ? stores[0] : null;

    // Generate encryption key if needed
    const encryptionKey = crypto.randomBytes(32).toString('hex');

    await connection.end();

    // Build .env content
    let envContent = `# ============================================
# Database Configuration
# ============================================
DB_HOST=${dbConfig.host}
DB_USER=${dbConfig.user}
DB_PASSWORD=${dbConfig.password}
DB_NAME=${dbConfig.database}
DB_PORT=${dbConfig.port}
DB_SSL=${dbConfig.ssl ? 'true' : 'false'}

# ============================================
# Server Configuration
# ============================================
PORT=5000
NODE_ENV=development

# ============================================
# CORS Configuration
# ============================================
CORS_ORIGIN=http://localhost:3000

# ============================================
# Shipway API Configuration
# ============================================
SHIPWAY_API_BASE_URL=https://app.shipway.com/api
SHIPWAY_USERNAME=${firstStore?.username || ''}
SHIPWAY_PASSWORD=
SHIPWAY_BASIC_AUTH_HEADER=

# ============================================
# Shopify API Configuration
# ============================================
SHOPIFY_STORE_URL=${firstStore?.shopify_store_url || ''}
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_PRODUCTS_API_URL=

# ============================================
# Security & Encryption
# ============================================
ENCRYPTION_KEY=${encryptionKey}
BCRYPT_ROUNDS=12

# ============================================
# Push Notifications (Optional)
# ============================================
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# ============================================
# Migration Configuration
# ============================================
RUN_MIGRATIONS=false

# ============================================
# Rate Limiting (Optional)
# ============================================
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ============================================
# Auto Reverse Orders (Optional)
# ============================================
AUTO_REVERSE_API_URL=http://localhost:5000/api/orders/auto-reverse-expired
AUTO_REVERSE_USERNAME=admin
AUTO_REVERSE_PASSWORD=admin123
`;

    // Write to .env file
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    fs.writeFileSync(envPath, envContent, 'utf8');

    console.log(`\n✅ .env file created at: ${envPath}`);
    console.log('\n📝 Note: You still need to manually fill in:');
    console.log('   - SHIPWAY_PASSWORD (for the first store)');
    console.log('   - SHIPWAY_BASIC_AUTH_HEADER (generate from username:password)');
    console.log('   - SHOPIFY_ACCESS_TOKEN (for the first store)');
    console.log(`\n🔑 Generated ENCRYPTION_KEY: ${encryptionKey}`);

    if (stores.length > 1) {
      console.log(`\n⚠️  You have ${stores.length} stores configured.`);
      console.log('   The .env file is set with the first store credentials for legacy support.');
      console.log('   Multi-store functionality uses credentials from store_info table.');

    }

  } catch (error) {
    console.error('❌ Error extracting credentials:', error.message);
    console.error('\n💡 Make sure your database is accessible and credentials are correct.');
    process.exit(1);
  }
}

extractCredentials();




