/**
 * Sync is_handover for Existing Labels
 * 
 * This script runs on deploy to update the is_handover column for all existing labels
 * based on their current_shipment_status. It uses the same logic as the tracking service.
 * 
 * Usage: node backend/scripts/sync-is-handover.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const database = require('../config/database');

/**
 * Determine if a status should set is_handover = 1
 * Based on Shipway API statuses:
 * - is_handover = 0: AWB_ASSIGNED, Shipment Booked, Pickup Failed, SHPFR3
 * - is_handover = 1: All other statuses (means package has been picked up and is in logistics flow)
 */
function shouldSetHandover(status) {
    if (!status || typeof status !== 'string') {
        return false;
    }

    const normalizedStatus = status.trim().toLowerCase();

    // Statuses where is_handover should remain 0 (pre-pickup or pickup failed)
    const noHandoverStatuses = [
        'awb_assigned',
        'awb assigned',
        'shipment booked',
        'shipment_booked',
        'pickup failed',
        'pickup_failed',
        'shpfr3'
    ];

    // Check if status is in the no-handover list
    const isNoHandover = noHandoverStatuses.some(s => normalizedStatus === s || normalizedStatus.includes(s));

    // is_handover = 1 for all other statuses
    return !isNoHandover;
}

/**
 * Main sync function
 */
async function syncIsHandover() {
    console.log('🚀 Starting is_handover sync for all existing labels...\n');
    const startTime = Date.now();

    try {
        // Wait for database initialization
        await database.waitForMySQLInitialization();

        if (!database.isMySQLAvailable()) {
            throw new Error('Database connection not available');
        }

        // Get all labels with current_shipment_status
        console.log('📋 Fetching all labels with current_shipment_status...');
        const labels = await database.query(`
      SELECT order_id, account_code, current_shipment_status, is_handover, handover_at
      FROM labels
      WHERE current_shipment_status IS NOT NULL AND current_shipment_status != ''
    `);

        console.log(`✅ Found ${labels.length} labels with status\n`);

        if (labels.length === 0) {
            console.log('ℹ️ No labels with status found. Nothing to sync.');
            return { success: true, message: 'No labels to sync', processed: 0 };
        }

        let totalProcessed = 0;
        let totalUpdated = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        // Process each label
        for (const label of labels) {
            try {
                const currentStatus = label.current_shipment_status;
                const currentIsHandover = label.is_handover || 0;
                const expectedIsHandover = shouldSetHandover(currentStatus) ? 1 : 0;

                // Check if update is needed
                if (currentIsHandover !== expectedIsHandover) {
                    // Build update query
                    let updateQuery = `UPDATE labels SET is_handover = ?`;
                    let queryParams = [expectedIsHandover];

                    // If setting is_handover = 1 and handover_at is null, set it to NOW()
                    if (expectedIsHandover === 1 && !label.handover_at) {
                        updateQuery += `, handover_at = NOW()`;
                    }

                    updateQuery += ` WHERE order_id = ? AND account_code = ?`;
                    queryParams.push(label.order_id, label.account_code);

                    await database.query(updateQuery, queryParams);

                    console.log(`  ✅ Updated ${label.order_id}: is_handover ${currentIsHandover} → ${expectedIsHandover} (status: "${currentStatus}")`);
                    totalUpdated++;
                } else {
                    totalSkipped++;
                }

                totalProcessed++;
            } catch (error) {
                console.error(`  ❌ Error processing ${label.order_id}:`, error.message);
                totalErrors++;
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log('\n' + '='.repeat(60));
        console.log('📊 SYNC COMPLETE - SUMMARY');
        console.log('='.repeat(60));
        console.log(`  Total labels processed: ${totalProcessed}`);
        console.log(`  is_handover updated:    ${totalUpdated}`);
        console.log(`  No change (skipped):    ${totalSkipped}`);
        console.log(`  Errors:                 ${totalErrors}`);
        console.log(`  Duration:               ${duration}s`);
        console.log('='.repeat(60) + '\n');

        return {
            success: true,
            message: 'is_handover sync completed',
            processed: totalProcessed,
            updated: totalUpdated,
            skipped: totalSkipped,
            errors: totalErrors,
            duration: `${duration}s`
        };

    } catch (error) {
        console.error('💥 Sync failed:', error.message);
        return {
            success: false,
            message: error.message
        };
    }
}

// Run the script
syncIsHandover()
    .then(result => {
        console.log('Script completed:', result.success ? 'SUCCESS' : 'FAILED');
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Script error:', error);
        process.exit(1);
    });
