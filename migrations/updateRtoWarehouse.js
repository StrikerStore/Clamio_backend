/**
 * One-time migration script to update rto_wh in rto_tracking table
 * Uses the new logic: extracts location from the latest activity in shipment_track_activities
 * 
 * This script runs once on deployment and marks itself as completed in the database.
 */

const database = require('../config/database');
const axios = require('axios');

// Migration identifier
const MIGRATION_NAME = 'update_rto_wh_from_latest_activity_v1';

class RTOWarehouseMigration {
    constructor() {
        this.shipwayApiUrl = 'https://app.shipway.com/api/tracking';
        this.storeCredentialsCache = new Map();
        this.processedCount = 0;
        this.updatedCount = 0;
        this.errorCount = 0;
    }

    /**
     * Check if this migration has already been run
     */
    async isMigrationCompleted() {
        try {
            await database.waitForMySQLInitialization();

            // Check if migrations table exists, create if not
            await database.mysqlConnection.execute(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          details TEXT
        )
      `);

            const [rows] = await database.mysqlConnection.execute(
                'SELECT * FROM migrations WHERE name = ?',
                [MIGRATION_NAME]
            );

            return rows.length > 0;
        } catch (error) {
            console.error('❌ [Migration] Error checking migration status:', error.message);
            return false;
        }
    }

    /**
     * Mark this migration as completed
     */
    async markMigrationCompleted(details) {
        try {
            await database.mysqlConnection.execute(
                'INSERT INTO migrations (name, details) VALUES (?, ?)',
                [MIGRATION_NAME, JSON.stringify(details)]
            );
            console.log('✅ [Migration] Marked as completed');
        } catch (error) {
            console.error('❌ [Migration] Error marking migration as completed:', error.message);
        }
    }

    /**
     * Get store credentials for Shipway API
     */
    async getStoreCredentials(accountCode) {
        if (this.storeCredentialsCache.has(accountCode)) {
            return this.storeCredentialsCache.get(accountCode);
        }

        const store = await database.getStoreByAccountCode(accountCode);
        if (!store || !store.auth_token) {
            throw new Error(`No auth_token found for store ${accountCode}`);
        }

        this.storeCredentialsCache.set(accountCode, store.auth_token);
        return store.auth_token;
    }

    /**
     * Fetch tracking data with activities from Shipway API
     */
    async fetchTrackingWithActivities(awb, accountCode) {
        try {
            const basicAuthHeader = await this.getStoreCredentials(accountCode);
            const apiUrl = `${this.shipwayApiUrl}?awb_numbers=${awb}&tracking_history=1`;

            const response = await axios.get(apiUrl, {
                headers: {
                    'Authorization': basicAuthHeader,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.status !== 200 || !Array.isArray(response.data) || response.data.length === 0) {
                return null;
            }

            const trackingResult = response.data.find(item => String(item.awb) === String(awb));
            if (!trackingResult || !trackingResult.tracking_details) {
                return null;
            }

            return trackingResult.tracking_details.shipment_track_activities || [];
        } catch (error) {
            console.error(`❌ [Migration] API error for AWB ${awb}:`, error.message);
            return null;
        }
    }

    /**
     * Extract RTO warehouse from shipment_track_activities (latest activity location)
     */
    extractRTOWarehouse(activities) {
        if (!activities || activities.length === 0) {
            return null;
        }

        // Filter out activities with invalid/empty dates
        const validActivities = activities.filter(activity =>
            activity.date && activity.date.trim() && activity.date !== '1970-01-01 05:30:00' && activity.date !== ''
        );

        if (validActivities.length === 0) {
            return null;
        }

        // Sort by date descending to get the latest activity
        const sortedActivities = validActivities.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB - dateA; // Latest first
        });

        return sortedActivities[0].location || null;
    }

    /**
     * Update rto_wh for a single record
     */
    async updateRTOWarehouse(record) {
        try {
            // Skip if no AWB (can't fetch tracking without it)
            if (!record.awb) {
                console.log(`⏭️ [Migration] Skipping order ${record.order_id} - no AWB`);
                return false;
            }

            // Fetch tracking data with activities
            const activities = await this.fetchTrackingWithActivities(record.awb, record.account_code);

            if (!activities) {
                console.log(`⏭️ [Migration] No activities found for order ${record.order_id} (AWB: ${record.awb})`);
                return false;
            }

            // Extract new rto_wh from latest activity
            const newRtoWh = this.extractRTOWarehouse(activities);

            if (!newRtoWh) {
                console.log(`⏭️ [Migration] No valid location found for order ${record.order_id}`);
                return false;
            }

            // Skip if rto_wh is the same
            if (record.rto_wh === newRtoWh) {
                console.log(`⏭️ [Migration] No change needed for order ${record.order_id} (rto_wh already correct)`);
                return false;
            }

            // Update the record
            await database.mysqlConnection.execute(
                'UPDATE rto_tracking SET rto_wh = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [newRtoWh, record.id]
            );

            console.log(`✅ [Migration] Updated order ${record.order_id}: "${record.rto_wh}" → "${newRtoWh}"`);
            return true;
        } catch (error) {
            console.error(`❌ [Migration] Error updating order ${record.order_id}:`, error.message);
            return false;
        }
    }

    /**
     * Run the migration
     */
    async run() {
        console.log('🚀 [Migration] Starting RTO warehouse migration...');
        console.log(`📋 [Migration] Name: ${MIGRATION_NAME}`);

        try {
            await database.waitForMySQLInitialization();

            if (!database.isMySQLAvailable()) {
                console.error('❌ [Migration] MySQL not available');
                return { success: false, message: 'Database not available' };
            }

            // Check if already completed
            const isCompleted = await this.isMigrationCompleted();
            if (isCompleted) {
                console.log('⏭️ [Migration] Already completed, skipping...');
                return { success: true, message: 'Migration already completed', skipped: true };
            }

            // Get all RTO tracking records that have AWB numbers
            const [records] = await database.mysqlConnection.execute(`
        SELECT rt.id, rt.order_id, rt.account_code, rt.rto_wh, l.awb
        FROM rto_tracking rt
        LEFT JOIN labels l ON rt.order_id = l.order_id AND rt.account_code = l.account_code
        WHERE l.awb IS NOT NULL
        ORDER BY rt.id
      `);

            console.log(`📦 [Migration] Found ${records.length} RTO records to process`);

            if (records.length === 0) {
                await this.markMigrationCompleted({ processedCount: 0, updatedCount: 0, errorCount: 0 });
                return { success: true, message: 'No records to process' };
            }

            // Process each record with rate limiting
            for (const record of records) {
                this.processedCount++;

                try {
                    const updated = await this.updateRTOWarehouse(record);
                    if (updated) {
                        this.updatedCount++;
                    }
                } catch (error) {
                    this.errorCount++;
                    console.error(`❌ [Migration] Error processing record ${record.id}:`, error.message);
                }

                // Rate limiting: wait 200ms between API calls to avoid overwhelming Shipway
                if (this.processedCount < records.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                // Progress log every 50 records
                if (this.processedCount % 50 === 0) {
                    console.log(`📊 [Migration] Progress: ${this.processedCount}/${records.length} processed, ${this.updatedCount} updated`);
                }
            }

            const details = {
                processedCount: this.processedCount,
                updatedCount: this.updatedCount,
                errorCount: this.errorCount,
                completedAt: new Date().toISOString()
            };

            await this.markMigrationCompleted(details);

            console.log('✅ [Migration] Completed!');
            console.log(`📊 [Migration] Results: ${this.processedCount} processed, ${this.updatedCount} updated, ${this.errorCount} errors`);

            return {
                success: true,
                message: 'Migration completed successfully',
                ...details
            };

        } catch (error) {
            console.error('❌ [Migration] Fatal error:', error);
            return {
                success: false,
                message: error.message,
                processedCount: this.processedCount,
                updatedCount: this.updatedCount,
                errorCount: this.errorCount
            };
        }
    }
}

// Export both the class and a run function
module.exports = {
    RTOWarehouseMigration,
    run: async () => {
        const migration = new RTOWarehouseMigration();
        return await migration.run();
    }
};
