/**
 * Migration: Fix RTO Inventory Product Codes
 * 
 * Problem:  product_code was being stored WITH the size suffix, e.g.:
 *           "CLU-ROM-TH-25/26-PV-XL" instead of "CLU-ROM-TH-25/26-PV"
 *
 * This migration:
 *   1. Finds all rows where product_code ends with "-{size}"
 *   2. Strips the size suffix
 *   3. Merges duplicates: if stripping creates a collision (same rto_wh + clean product_code + size),
 *      adds the quantities together and deletes the original row
 *
 * Safe to run multiple times (idempotent).
 */

const MIGRATION_KEY = 'fix_rto_inventory_product_codes_v1';

async function run() {
    const database = require('../config/database');
    await database.waitForMySQLInitialization();

    if (!database.mysqlConnection) {
        console.log('[Migration] Database not available, skipping');
        return { skipped: true };
    }

    try {
        // Check if already run
        const [migrationRows] = await database.mysqlConnection.execute(
            `SELECT 1 FROM migrations WHERE migration_key = ? LIMIT 1`,
            [MIGRATION_KEY]
        ).catch(() => [[]]);  // table might not exist yet

        if (migrationRows.length > 0) {
            return { skipped: true, message: 'Already completed' };
        }

        console.log('[Migration] Fixing RTO inventory product codes...');

        // Get all rows where product_code likely has size suffix
        const [rows] = await database.mysqlConnection.execute(`
      SELECT id, rto_wh, product_code, size, quantity
      FROM rto_inventory
      WHERE size IS NOT NULL AND size != ''
        AND product_code LIKE CONCAT('%-', size)
    `);

        console.log(`[Migration] Found ${rows.length} rows with size suffix in product_code`);

        if (rows.length === 0) {
            // Mark as done even if nothing to fix
            await markComplete(database);
            return { success: true, updatedCount: 0, mergedCount: 0, message: 'No rows needed fixing' };
        }

        let updatedCount = 0;
        let mergedCount = 0;
        let deletedIds = [];

        for (const row of rows) {
            const cleanCode = row.product_code.slice(0, -(row.size.length + 1));

            // Check if a row with the clean product_code already exists (different from current row)
            const [existing] = await database.mysqlConnection.execute(`
        SELECT id, quantity FROM rto_inventory
        WHERE rto_wh = ? AND product_code = ? AND size = ? AND id != ?
      `, [row.rto_wh, cleanCode, row.size, row.id]);

            if (existing.length > 0) {
                // Merge: add quantity to existing row, delete this one
                const targetRow = existing[0];
                const newQty = targetRow.quantity + row.quantity;

                await database.mysqlConnection.execute(
                    `UPDATE rto_inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [newQty, targetRow.id]
                );
                deletedIds.push(row.id);
                mergedCount++;
                console.log(`  🔀 Merged: "${row.product_code}" → "${cleanCode}" (qty ${row.quantity} added to existing row ${targetRow.id}, total ${newQty})`);
            } else {
                // Simple update: just strip the suffix
                await database.mysqlConnection.execute(
                    `UPDATE rto_inventory SET product_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [cleanCode, row.id]
                );
                updatedCount++;
                console.log(`  ✅ Fixed: "${row.product_code}" → "${cleanCode}"`);
            }
        }

        // Delete merged duplicate rows
        if (deletedIds.length > 0) {
            const placeholders = deletedIds.map(() => '?').join(', ');
            await database.mysqlConnection.execute(
                `DELETE FROM rto_inventory WHERE id IN (${placeholders})`,
                deletedIds
            );
            console.log(`  🗑️ Deleted ${deletedIds.length} merged duplicate row(s)`);
        }

        // Mark migration as complete
        await markComplete(database);

        console.log(`[Migration] Done! Updated: ${updatedCount}, Merged: ${mergedCount}`);
        return { success: true, updatedCount, mergedCount };

    } catch (error) {
        console.error('[Migration] Error fixing RTO inventory product codes:', error.message);
        return { success: false, message: error.message };
    }
}

async function markComplete(database) {
    try {
        // Ensure migrations table exists
        await database.mysqlConnection.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_key VARCHAR(255) UNIQUE NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await database.mysqlConnection.execute(
            `INSERT IGNORE INTO migrations (migration_key) VALUES (?)`,
            [MIGRATION_KEY]
        );
    } catch (e) {
        console.warn('[Migration] Could not mark migration as complete:', e.message);
    }
}

module.exports = { run };
