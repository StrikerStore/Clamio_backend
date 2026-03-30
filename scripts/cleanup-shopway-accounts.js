/**
 * Cleanup helper to delete all rows associated with specific Shipway account_code values.
 *
 * Usage:
 *   node scripts/cleanup-shopway-accounts.js
 *
 * WARNING:
 *   Destructive: deletes from every table that has an `account_code` column.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mysql = require('mysql2/promise');

const DEFAULT_TARGET_ACCOUNT_CODES = ['PLEX', 'PLEX2'];

async function main() {
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
    throw new Error('Missing DB env vars: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
  }

  const targetAccountCodes = process.argv.slice(2).filter(Boolean);
  const targets = targetAccountCodes.length > 0 ? targetAccountCodes : DEFAULT_TARGET_ACCOUNT_CODES;

  const conn = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  const sqlTables = `
    SELECT c.TABLE_NAME
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
     AND t.TABLE_NAME = c.TABLE_NAME
    WHERE c.TABLE_SCHEMA = ?
      AND c.COLUMN_NAME = 'account_code'
      AND t.TABLE_TYPE = 'BASE TABLE'
  `;

  const [tables] = await conn.query(sqlTables, [DB_NAME]);

  console.log(
    `Deleting rows for account_code IN (${targets.join(', ')}) across ${tables.length} table(s) that have account_code...`,
  );

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');

  for (const t of tables) {
    const tableName = t.TABLE_NAME;
    const placeholders = targets.map(() => '?').join(', ');
    const delSql = `DELETE FROM \`${tableName}\` WHERE account_code IN (${placeholders})`;
    const [res] = await conn.query(delSql, targets);

    if (res.affectedRows > 0) {
      console.log(`  ✅ ${tableName}: deleted ${res.affectedRows}`);
    }
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  await conn.end();

  console.log('Done.');
}

main().catch((e) => {
  console.error('Cleanup failed:', e.message);
  process.exit(1);
});

