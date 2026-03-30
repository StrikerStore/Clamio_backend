/**
 * Verify products.sku_id is NOT NULL and no NULL/blank sku rows exist.
 *
 * Usage:
 *   node scripts/verify-sku-not-null.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mysql = require('mysql2/promise');

async function main() {
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
    throw new Error('Missing DB env vars: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
  }

  const conn = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  const [cnt] = await conn.query(
    "SELECT COUNT(*) AS c FROM products WHERE sku_id IS NULL OR TRIM(sku_id) = ''",
  );
  const [col] = await conn.query("SHOW COLUMNS FROM products WHERE Field = 'sku_id'");

  console.log({
    nullOrBlankSkuRows: cnt[0].c,
    skuNullAllowed: col[0]?.Null,
    skuType: col[0]?.Type,
  });

  await conn.end();
}

main().catch((e) => {
  console.error('Verification failed:', e.message);
  process.exit(1);
});

