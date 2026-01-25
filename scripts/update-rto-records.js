/**
 * Update RTO Records script
 * 
 * This script runs on deployment to update the days_since_initiated and is_focus columns
 * in the rto_tracking table. This caught up with old records and ensures data consistency.
 * 
 * Usage: node backend/scripts/update-rto-records.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const database = require('../config/database');

/**
 * Main update function
 */
async function updateRTORecords() {
    console.log('🚀 Starting RTO tracking records update...\n');
    const startTime = Date.now();

    try {
        // Wait for database initialization
        await database.waitForMySQLInitialization();

        if (!database.isMySQLAvailable()) {
            throw new Error('Database connection not available');
        }

        console.log('🔄 Calling updateRTODaysAndFocus algorithm...');

        // This method updates days_since_initiated and is_focus for all records in rto_tracking
        await database.updateRTODaysAndFocus();

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log('\n' + '='.repeat(60));
        console.log('📊 RTO UPDATE COMPLETE');
        console.log('='.repeat(60));
        console.log(`  Duration:               ${duration}s`);
        console.log('='.repeat(60) + '\n');

        return {
            success: true,
            message: 'RTO records updated successfully',
            duration: `${duration}s`
        };

    } catch (error) {
        console.error('💥 RTO Update failed:', error.message);
        return {
            success: false,
            message: error.message
        };
    }
}

// Run the script
updateRTORecords()
    .then(result => {
        console.log('Script completed:', result.success ? 'SUCCESS' : 'FAILED');
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Script error:', error);
        process.exit(1);
    });
