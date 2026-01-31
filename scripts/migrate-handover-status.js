const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');
const orderTrackingService = require('../services/orderTrackingService');

/**
 * ONE-TIME MIGRATION SCRIPT
 * Run this once during deployment to fix historical data issues:
 * 1. Fix orders with handover-qualifying statuses but is_handover = 0
 * 2. Set handover_at timestamps from order_tracking history
 * 
 * This script is idempotent - safe to run multiple times.
 */

async function runMigration() {
    const migrationName = '2026-01-31_fix_handover_status';
    console.log('════════════════════════════════════════════════════════════');
    console.log(`🚀 Running Migration: ${migrationName}`);
    console.log('════════════════════════════════════════════════════════════\n');

    try {
        await database.waitForMySQLInitialization();

        if (!database.isMySQLAvailable()) {
            throw new Error('Database connection not available');
        }

        // Check if this migration has already been run
        const [migrationRecord] = await database.mysqlConnection.execute(`
            SELECT * FROM utility WHERE parameter = ?
        `, [`migration_${migrationName}`]);

        if (migrationRecord.length > 0) {
            console.log('✅ Migration already completed on:', migrationRecord[0].created_at);
            console.log('   Skipping to avoid duplicate execution.\n');
            console.log('════════════════════════════════════════════════════════════');
            return;
        }

        console.log('📋 Step 1: Finding orders with tracking history but incorrect handover status...\n');

        // Find orders that have tracking records but is_handover = 0
        const [candidates] = await database.mysqlConnection.execute(`
            SELECT DISTINCT l.order_id, l.account_code, l.awb, l.current_shipment_status
            FROM labels l
            INNER JOIN order_tracking ot ON l.order_id = ot.order_id AND l.account_code = ot.account_code
            WHERE l.is_handover = 0 OR l.handover_at IS NULL
        `);

        console.log(`   Found ${candidates.length} candidates to check\n`);

        if (candidates.length === 0) {
            console.log('✅ No orders need fixing!\n');

            // Mark migration as complete
            await database.mysqlConnection.execute(`
                INSERT INTO utility (parameter, value, created_by)
                VALUES (?, ?, 'migration_script')
            `, [`migration_${migrationName}`, JSON.stringify({
                completed_at: new Date().toISOString(),
                orders_fixed: 0,
                orders_skipped: 0
            })]);

            console.log('════════════════════════════════════════════════════════════');
            return;
        }

        console.log('📋 Step 2: Processing orders and checking tracking history...\n');

        let fixedCount = 0;
        let skippedCount = 0;
        let processedCount = 0;

        for (const candidate of candidates) {
            const { order_id, account_code, current_shipment_status } = candidate;
            processedCount++;

            // Get all tracking events for this order (chronologically)
            const [events] = await database.mysqlConnection.execute(`
                SELECT shipment_status, timestamp
                FROM order_tracking
                WHERE order_id = ? AND account_code = ?
                ORDER BY timestamp ASC
            `, [order_id, account_code]);

            if (events.length === 0) {
                skippedCount++;
                continue;
            }

            let hasHandoverEvent = false;
            let firstHandoverTime = null;
            let triggeringStatus = '';

            // Scan through ALL events to find the first handover event
            for (const event of events) {
                const isHandover = await orderTrackingService.shouldSetHandover(event.shipment_status);
                if (isHandover) {
                    hasHandoverEvent = true;
                    firstHandoverTime = event.timestamp;
                    triggeringStatus = event.shipment_status;
                    break; // Found the first handover event
                }
            }

            if (hasHandoverEvent) {
                console.log(`   ✓ [${processedCount}/${candidates.length}] Fixing ${order_id} (${account_code})`);
                console.log(`     - Handover event: "${triggeringStatus}" at ${firstHandoverTime}`);
                console.log(`     - Current status: "${current_shipment_status}"`);

                // Update the label with correct handover data
                await database.mysqlConnection.execute(`
                    UPDATE labels 
                    SET is_handover = 1, handover_at = ?
                    WHERE order_id = ? AND account_code = ?
                `, [firstHandoverTime || new Date(), order_id, account_code]);

                fixedCount++;
            } else {
                skippedCount++;
                if (processedCount <= 3) {
                    console.log(`   ⊘ [${processedCount}/${candidates.length}] Skipping ${order_id} - no handover events`);
                }
            }
        }

        console.log('\n════════════════════════════════════════════════════════════');
        console.log('📊 Migration Summary:');
        console.log(`   - Total candidates checked: ${processedCount}`);
        console.log(`   - Orders fixed: ${fixedCount}`);
        console.log(`   - Orders skipped (no handover events): ${skippedCount}`);
        console.log('════════════════════════════════════════════════════════════\n');

        // Mark migration as complete
        await database.mysqlConnection.execute(`
            INSERT INTO utility (parameter, value, created_by)
            VALUES (?, ?, 'migration_script')
        `, [`migration_${migrationName}`, JSON.stringify({
            completed_at: new Date().toISOString(),
            orders_fixed: fixedCount,
            orders_skipped: skippedCount,
            total_processed: processedCount
        })]);

        console.log('✅ Migration completed successfully!\n');
        console.log('════════════════════════════════════════════════════════════\n');

        process.exit(0);

    } catch (error) {
        console.error('\n════════════════════════════════════════════════════════════');
        console.error('💥 Migration Failed:', error.message);
        console.error('════════════════════════════════════════════════════════════\n');
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Run the migration
runMigration();
