/**
 * Sync All Tracking Status Script
 * 
 * This script is designed to run on deploy to sync tracking status for all AWBs
 * in the labels table. It fetches current status from Shipway API and updates
 * the labels table if there are any changes.
 * 
 * Usage: node backend/scripts/sync-all-tracking-status.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');
const database = require('../config/database');

// Configuration
const SHIPWAY_API_URL = 'https://app.shipway.com/api/tracking';
const BATCH_SIZE = 10; // Number of AWBs to process per API call (comma-separated)
const DELAY_BETWEEN_BATCHES_MS = 1000; // Delay between batches to avoid rate limiting

/**
 * Normalize shipment status (same logic as orderTrackingService)
 */
function normalizeShipmentStatus(status) {
    if (!status || typeof status !== 'string') {
        return status || 'Unknown';
    }

    const normalized = status.trim().toLowerCase().replace(/_/g, ' ');

    // Handle failure statuses
    if (normalized.includes('pickup failed') || normalized.includes('failed pickup')) {
        return 'Pickup Failed';
    }

    // Map pickup variations to "In Transit"
    if (
        normalized.includes('picked') ||
        normalized.includes('pickup') ||
        normalized === 'in transit'
    ) {
        return 'In Transit';
    }

    // Normalize "Delivered"
    if (normalized === 'delivered') {
        return 'Delivered';
    }

    // Common statuses mapping
    const commonStatuses = {
        'out for delivery': 'Out for Delivery',
        'rto': 'RTO',
        'cancelled': 'Cancelled',
        'returned': 'Returned',
        'failed delivery': 'Failed Delivery',
        'attempted delivery': 'Attempted Delivery',
        'shipment booked': 'Shipment Booked',
        'dispatched': 'Dispatched',
        'in warehouse': 'In Warehouse',
        'out for pickup': 'Out for Pickup',
        'rto delivered': 'RTO Delivered'
    };

    if (commonStatuses[normalized]) {
        return commonStatuses[normalized];
    }

    return status;
}

/**
 * Get all labels with AWB numbers grouped by account_code
 */
async function getAllLabelsWithAWB() {
    const query = `
    SELECT 
      l.order_id,
      l.awb,
      l.current_shipment_status,
      l.is_handover,
      l.handover_at,
      l.account_code,
      s.auth_token
    FROM labels l
    INNER JOIN stores s ON l.account_code = s.account_code AND s.status = 'active'
    WHERE l.awb IS NOT NULL 
    AND l.awb != ''
    ORDER BY l.account_code, l.order_id
  `;

    return await database.query(query);
}

/**
 * Fetch tracking status from Shipway API for multiple AWBs
 */
async function fetchTrackingFromShipway(awbNumbers, authToken) {
    try {
        const awbString = awbNumbers.join(',');
        const apiUrl = `${SHIPWAY_API_URL}?awb_numbers=${awbString}&tracking_history=0`;

        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (response.status !== 200) {
            throw new Error(`Shipway API returned status ${response.status}`);
        }

        return response.data;
    } catch (error) {
        if (error.response) {
            console.error(`❌ Shipway API error:`, error.response.status, error.response.data);
        } else if (error.code === 'ECONNABORTED') {
            console.error('❌ Request timeout - Shipway API not responding');
        } else {
            console.error(`❌ Network error:`, error.message);
        }
        return null;
    }
}

/**
 * Update label with new tracking status
 */
async function updateLabelStatus(orderId, accountCode, newStatus, isHandover) {
    const currentDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');

    let updateQuery = `
    UPDATE labels 
    SET current_shipment_status = ?,
        updated_at = NOW()
  `;
    let queryParams = [newStatus];

    // Only set is_handover if transitioning from 0 to 1
    if (isHandover) {
        updateQuery += `, is_handover = 1`;
        updateQuery += `, handover_at = COALESCE(handover_at, ?)`;
        queryParams.push(currentDateTime);
    }

    updateQuery += ` WHERE order_id = ? AND account_code = ?`;
    queryParams.push(orderId, accountCode);

    await database.query(updateQuery, queryParams);
}

/**
 * Main sync function
 */
async function syncAllTrackingStatus() {
    console.log('🚀 Starting tracking status sync for all AWBs...\n');
    const startTime = Date.now();

    try {
        // Wait for database initialization
        await database.waitForMySQLInitialization();

        if (!database.isMySQLAvailable()) {
            throw new Error('Database connection not available');
        }

        // Get all labels with AWBs
        console.log('📋 Fetching all labels with AWB numbers...');
        const labels = await getAllLabelsWithAWB();
        console.log(`✅ Found ${labels.length} labels with AWB numbers\n`);

        if (labels.length === 0) {
            console.log('ℹ️ No labels with AWB numbers found. Nothing to sync.');
            return { success: true, message: 'No labels to sync', processed: 0 };
        }

        // Group labels by account_code
        const labelsByStore = {};
        labels.forEach(label => {
            if (!labelsByStore[label.account_code]) {
                labelsByStore[label.account_code] = {
                    authToken: label.auth_token,
                    labels: []
                };
            }
            labelsByStore[label.account_code].labels.push(label);
        });

        let totalProcessed = 0;
        let totalUpdated = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        // Process each store
        for (const [accountCode, storeData] of Object.entries(labelsByStore)) {
            console.log(`\n📦 Processing store: ${accountCode} (${storeData.labels.length} AWBs)`);

            const storeLabels = storeData.labels;
            const authToken = storeData.authToken;

            // Process in batches
            for (let i = 0; i < storeLabels.length; i += BATCH_SIZE) {
                const batch = storeLabels.slice(i, i + BATCH_SIZE);
                const awbNumbers = batch.map(l => l.awb);

                console.log(`  🔄 Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(storeLabels.length / BATCH_SIZE)}: Processing ${awbNumbers.length} AWBs...`);

                // Fetch tracking data from Shipway
                const trackingData = await fetchTrackingFromShipway(awbNumbers, authToken);

                if (!trackingData || !Array.isArray(trackingData)) {
                    console.log(`  ⚠️ No tracking data received for this batch`);
                    totalErrors += batch.length;
                    continue;
                }

                // Process each label in the batch
                for (const label of batch) {
                    try {
                        // Find tracking result for this AWB
                        const trackingResult = trackingData.find(item => String(item.awb) === String(label.awb));

                        if (!trackingResult || !trackingResult.tracking_details || !trackingResult.tracking_details.shipment_status) {
                            console.log(`    ⚠️ No tracking data for AWB ${label.awb} (Order: ${label.order_id})`);
                            totalSkipped++;
                            continue;
                        }

                        const rawStatus = trackingResult.tracking_details.shipment_status;
                        const normalizedStatus = normalizeShipmentStatus(rawStatus);
                        const currentStatus = label.current_shipment_status;

                        // Check if status has changed
                        if (normalizedStatus !== currentStatus) {
                            const isHandover = normalizedStatus === 'In Transit' && label.is_handover !== 1;

                            await updateLabelStatus(label.order_id, label.account_code, normalizedStatus, isHandover);

                            console.log(`    ✅ Updated AWB ${label.awb}: "${currentStatus || 'null'}" → "${normalizedStatus}"${isHandover ? ' (+ handover)' : ''}`);
                            totalUpdated++;
                        } else {
                            totalSkipped++;
                        }

                        totalProcessed++;
                    } catch (error) {
                        console.error(`    ❌ Error processing AWB ${label.awb}:`, error.message);
                        totalErrors++;
                    }
                }

                // Delay between batches
                if (i + BATCH_SIZE < storeLabels.length) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log('\n' + '='.repeat(60));
        console.log('📊 SYNC COMPLETE - SUMMARY');
        console.log('='.repeat(60));
        console.log(`  Total AWBs processed: ${totalProcessed}`);
        console.log(`  Status updated:       ${totalUpdated}`);
        console.log(`  No change (skipped):  ${totalSkipped}`);
        console.log(`  Errors:               ${totalErrors}`);
        console.log(`  Duration:             ${duration}s`);
        console.log('='.repeat(60) + '\n');

        return {
            success: true,
            message: 'Tracking status sync completed',
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
syncAllTrackingStatus()
    .then(result => {
        console.log('Script completed:', result.success ? 'SUCCESS' : 'FAILED');
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Script error:', error);
        process.exit(1);
    });
