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
 *
 * Idempotent — safe to run on every server start.
 */

const crypto = require('crypto');

function newUniqueId(accountCode, orderId, productCode) {
  const storePart = accountCode || 'GLOBAL';
  const id = `${storePart}_${orderId}_${productCode}`;
  return crypto.createHash('md5').update(id).digest('hex').substring(0, 12).toUpperCase();
}

async function runUniqueIdMigration(database) {
  console.log('\n🔄 ========================================');
  console.log('   UNIQUE_ID MIGRATION (remove itemIndex)');
  console.log('========================================\n');

  const db = database.mysqlPool || database.mysqlConnection;
  if (!db) {
    console.error('❌ MySQL connection not available, skipping unique_id migration');
    return;
  }

  console.log('🔍 Fetching all rows from orders table...');
  const [rows] = await db.execute(
    'SELECT id, unique_id, order_id, product_code, account_code FROM orders'
  );
  console.log(`   Found ${rows.length} rows.`);

  let updated = 0;
  let skipped = 0;
  let collisions = 0;

  for (const row of rows) {
    const calculated = newUniqueId(row.account_code, row.order_id, row.product_code);

    if (row.unique_id === calculated) {
      skipped++;
      continue;
    }

    console.log(`📝 ${row.unique_id}  →  ${calculated}  (${row.account_code}|${row.order_id}|${row.product_code})`);

    try {
      // Update claims first (FK child) before changing orders (FK parent)
      await db.execute(
        'UPDATE claims SET order_unique_id = ? WHERE order_unique_id = ?',
        [calculated, row.unique_id]
      );

      // Update orders table (both id and unique_id)
      await db.execute(
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

  console.log('\n✅ Unique_id migration complete.');
  console.log(`   Updated  : ${updated}`);
  console.log(`   Already OK: ${skipped}`);
  console.log(`   Collisions: ${collisions}`);

  if (collisions > 0) {
    console.warn('\n⚠️  Collisions mean two rows in the same order share the same product_code.');
    console.warn('   Those rows were left unchanged. Review them manually.');
  }

  console.log('========================================\n');
}

module.exports = { runUniqueIdMigration };
