/**
 * Helper script to generate INSERT statement for Striker Store
 * This script will:
 * 1. Encrypt the password from environment variables
 * 2. Generate a ready-to-use INSERT statement
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const encryptionService = require('../services/encryptionService');

// Get values from environment
const shipwayUsername = process.env.SHIPWAY_USERNAME;
const shipwayPassword = process.env.SHIPWAY_PASSWORD;
const shipwayBasicAuth = process.env.SHIPWAY_BASIC_AUTH_HEADER;
const shopifyStoreUrl = process.env.SHOPIFY_STORE_URL;
const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;

if (!shipwayUsername || !shipwayPassword || !shipwayBasicAuth) {
  console.error('❌ Missing Shipway credentials in .env:');
  console.error('   Required: SHIPWAY_USERNAME, SHIPWAY_PASSWORD, SHIPWAY_BASIC_AUTH_HEADER');
  process.exit(1);
}

if (!shopifyStoreUrl || !shopifyToken) {
  console.error('❌ Missing Shopify credentials in .env:');
  console.error('   Required: SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN');
  process.exit(1);
}

try {
  // Encrypt the password
  const encryptedPassword = encryptionService.encrypt(shipwayPassword);
  
  // Escape single quotes in string values for SQL
  const escapeSQL = (str) => str.replace(/'/g, "''");
  
  // Generate INSERT statement
  const insertStatement = `INSERT INTO store_info (
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
) VALUES (
  'STRI',
  'Striker Store',
  'Shipway',
  '${escapeSQL(shipwayUsername)}',
  '${encryptedPassword}',
  '${escapeSQL(shipwayBasicAuth)}',
  '${escapeSQL(shopifyStoreUrl)}',
  '${escapeSQL(shopifyToken)}',
  'active',
  'system'
);`;

  console.log('\n✅ Generated INSERT statement for Striker Store:\n');
  console.log('='.repeat(80));
  console.log(insertStatement);
  console.log('='.repeat(80));
  console.log('\n📋 Copy and paste the above SQL statement into your database client.\n');
  
} catch (error) {
  console.error('❌ Error generating INSERT statement:', error.message);
  process.exit(1);
}


