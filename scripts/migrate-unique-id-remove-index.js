/**
 * Migration: Recalculate unique_id without itemIndex
 *
 * OLD formula: hash(accountCode_orderId_productCode_itemIndex)
 * NEW formula: hash(accountCode_orderId_productCode)
 *
 * Updates:
 *   - orders.id
 *   - orders.unique_id
 *   - claims.order_unique_id
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const crypto = require('crypto');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'clamio_db',
  charset: 'utf8mb4'
};

function newUniqueId(accountCode, orderId, productCode) {
  const storePart = accountCode || 'GLOBAL';
  const id = `${storePart}_${orderId}_${productCode}`;
  return crypto.createHash('md5').update(id).digest('hex').substring(0, 12).toUpperCase();
}

async function migrate() {
  let connection;

  try {
    console.log('🚀 Starting migration: Remove itemIndex from unique_id');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Connected to database');

    console.log('\n🔍 Fetching all rows from orders table...');
    const [rows] = await connection.execute(
      'SELECT id, unique_id, order_id, product_code, account_code FROM orders'
    );
    console.log(`   Found ${rows.length} rows.\n`);

    let updated = 0;
    let skipped = 0;
    let collisions = 0;

    for (const row of rows) {
      const calculated = newUniqueId(row.account_code, row.order_id, row.product_code);

      if (row.unique_id === calculated) {
        skipped++;
        continue; // already on new formula
      }

      console.log(`📝 ${row.unique_id}  →  ${calculated}  (${row.account_code}|${row.order_id}|${row.product_code})`);

      try {
        // Update claims first (FK child) before changing orders (FK parent)
        await connection.execute(
          'UPDATE claims SET order_unique_id = ? WHERE order_unique_id = ?',
          [calculated, row.unique_id]
        );

        // Update orders table (both id and unique_id)
        await connection.execute(
          'UPDATE orders SET id = ?, unique_id = ? WHERE unique_id = ?',
          [calculated, calculated, row.unique_id]
        );

        updated++;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          console.warn(`   ⚠️  COLLISION — new unique_id ${calculated} already exists. Skipping row ${row.unique_id}.`);
          collisions++;
        } else {
          throw err;
        }
      }
    }

    console.log('\n✅ Migration complete.');
    console.log(`   Updated  : ${updated}`);
    console.log(`   Already OK: ${skipped}`);
    console.log(`   Collisions: ${collisions}`);

    if (collisions > 0) {
      console.warn('\n⚠️  Collisions mean two rows in the same order share the same product_code.');
      console.warn('   Those rows were left unchanged. Review them manually.');
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }

  process.exit(0);
}

migrate();
