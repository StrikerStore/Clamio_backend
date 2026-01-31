const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');
const orderTrackingService = require('../services/orderTrackingService');

// Check for dry-run mode
const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

async function runFix() {
    try {
        if (isDryRun) {
            console.log('🔍 [DRY RUN MODE] No changes will be made to the database');
            console.log('');
        }

        console.log('🚀 [Retroactive Fix] Starting handover status fix from tracking history...');

        await database.waitForMySQLInitialization();
        if (!database.isMySQLAvailable()) {
            throw new Error('Database connection not available');
        }

        // 1. Find orders that are NOT marked as handed over (is_handover = 0)
        // but have tracking records in order_tracking
        const [candidates] = await database.mysqlConnection.execute(`
            SELECT DISTINCT l.order_id, l.account_code, l.awb
            FROM labels l
            INNER JOIN order_tracking ot ON l.order_id = ot.order_id AND l.account_code = ot.account_code
            WHERE l.is_handover = 0
        `);

        console.log(`📊 [Retroactive Fix] Found ${candidates.length} candidates with tracking history but is_handover = 0`);

        if (candidates.length === 0) {
            console.log('✅ [Retroactive Fix] No orders need fixing!');
            process.exit(0);
        }

        let fixedCount = 0;
        let processedCount = 0;
        let skippedCount = 0;

        for (const candidate of candidates) {
            const { order_id, account_code } = candidate;
            processedCount++;

            // Get all tracking events for this order
            const [events] = await database.mysqlConnection.execute(`
                SELECT shipment_status, timestamp
                FROM order_tracking
                WHERE order_id = ? AND account_code = ?
                ORDER BY timestamp ASC
            `, [order_id, account_code]);

            let hasHandoverEvent = false;
            let firstHandoverTime = null;
            let triggeringStatus = '';

            for (const event of events) {
                const isHandover = await orderTrackingService.shouldSetHandover(event.shipment_status);
                if (isHandover) {
                    hasHandoverEvent = true;
                    firstHandoverTime = event.timestamp;
                    triggeringStatus = event.shipment_status;
                    break; // Found the first one, that's enough
                }
            }

            if (hasHandoverEvent) {
                console.log(`🚚 [${processedCount}/${candidates.length}] ${isDryRun ? 'WOULD FIX' : 'Fixing'} order ${order_id} (${account_code}): Found historical handover event "${triggeringStatus}" at ${firstHandoverTime}`);

                if (!isDryRun) {
                    await database.mysqlConnection.execute(`
                        UPDATE labels 
                        SET is_handover = 1, handover_at = ?
                        WHERE order_id = ? AND account_code = ?
                    `, [firstHandoverTime || new Date(), order_id, account_code]);
                }

                fixedCount++;
            } else {
                skippedCount++;
                if (processedCount <= 5) {
                    console.log(`⏭️  [${processedCount}/${candidates.length}] Skipping order ${order_id} (${account_code}): No handover events in tracking history`);
                }
            }
        }

        console.log(`\n========================================`);
        console.log(`✅ [Retroactive Fix] Processing completed!`);
        console.log(`   - Total candidates checked: ${processedCount}`);
        console.log(`   - Orders ${isDryRun ? 'that would be' : ''} fixed: ${fixedCount}`);
        console.log(`   - Orders skipped (no handover events): ${skippedCount}`);

        if (isDryRun) {
            console.log(`\n💡 Run without --dry-run flag to apply these changes`);
        }
        console.log(`========================================\n`);

        process.exit(0);
    } catch (error) {
        console.error('💥 [Retroactive Fix] Failed:', error);
        process.exit(1);
    }
}

runFix();

