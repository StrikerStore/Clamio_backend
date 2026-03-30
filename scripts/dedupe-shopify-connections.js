/**
 * Dedupe store_shopify_connections on (account_code, store_code) and ensure unique index exists.
 *
 * Usage:
 *   node scripts/dedupe-shopify-connections.js [ACCOUNT_CODE]
 *
 * If ACCOUNT_CODE is provided, dedupes only that account; otherwise dedupes all.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mysql = require('mysql2/promise');

async function main() {
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
    throw new Error('Missing DB env vars: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
  }

  const accountCode = process.argv[2] || null;

  const conn = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');

  const where = accountCode ? 'WHERE sc1.account_code = ?' : '';
  const params = accountCode ? [accountCode] : [];

  const delSql = `
    DELETE sc1
    FROM store_shopify_connections sc1
    JOIN store_shopify_connections sc2
      ON sc1.account_code = sc2.account_code
     AND sc1.store_code = sc2.store_code
     AND (
          sc1.updated_at < sc2.updated_at
       OR (sc1.updated_at = sc2.updated_at AND sc1.id < sc2.id)
     )
    ${where}
  `;

  const [res] = await conn.query(delSql, params);
  console.log('Dedup deleted rows:', res.affectedRows);

  const [idx] = await conn.query(
    "SHOW INDEX FROM store_shopify_connections WHERE Key_name = 'uq_account_store_code'",
  );
  if (idx.length === 0) {
    await conn.query(
      'ALTER TABLE store_shopify_connections ADD UNIQUE KEY uq_account_store_code (account_code, store_code)',
    );
    console.log('Unique index added: uq_account_store_code');
  } else {
    console.log('Unique index already exists: uq_account_store_code');
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  if (accountCode) {
    const [rows] = await conn.query(
      'SELECT id, account_code, brand_name, store_code, shopify_store_url, status, updated_at FROM store_shopify_connections WHERE account_code = ? ORDER BY store_code, id',
      [accountCode],
    );
    console.table(rows);
  }

  await conn.end();
}

main().catch((e) => {
  console.error('Dedupe failed:', e.message);
  process.exit(1);
});

