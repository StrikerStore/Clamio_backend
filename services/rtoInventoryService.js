const database = require('../config/database');

/**
 * RTO Inventory Service
 * Handles processing of delivered RTO orders and updating inventory
 * Aggregates product quantities by RTO warehouse, product code, and size
 */
class RTOInventoryService {
    constructor() {
        this.isProcessing = false;
    }

    /**
     * Process delivered RTO orders and update inventory
     * This is the main entry point for RTO inventory processing
     * @returns {Promise<Object>} Processing result with stats
     */
    async processDeliveredRTOOrders() {
        if (this.isProcessing) {
            console.log('🔄 [RTO Inventory Service] Processing already in progress, skipping...');
            return {
                success: false,
                message: 'RTO inventory processing already in progress'
            };
        }

        this.isProcessing = true;

        try {
            console.log('🚀 [RTO Inventory Service] Starting RTO inventory processing...');

            await database.waitForMySQLInitialization();

            if (!database.isMySQLAvailable()) {
                throw new Error('Database connection not available');
            }

            // Delegate to database function which handles the core logic
            const result = await database.processRTOInventory();

            return {
                ...result,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('💥 [RTO Inventory Service] Processing failed:', error.message);
            return {
                success: false,
                message: error.message,
                timestamp: new Date().toISOString()
            };
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get RTO inventory summary
     * @returns {Promise<Array>} Array of RTO inventory records
     */
    async getRTOInventory() {
        try {
            await database.waitForMySQLInitialization();

            if (!database.isMySQLAvailable()) {
                throw new Error('Database connection not available');
            }

            return await database.getRTOInventory();
        } catch (error) {
            console.error('❌ [RTO Inventory Service] Error getting RTO inventory:', error.message);
            throw error;
        }
    }

    /**
     * Get unprocessed RTO delivered orders (for debugging/monitoring)
     * @returns {Promise<Array>} Array of unprocessed RTO orders
     */
    async getUnprocessedOrders() {
        try {
            await database.waitForMySQLInitialization();

            if (!database.isMySQLAvailable()) {
                throw new Error('Database connection not available');
            }

            return await database.getUnprocessedRTODeliveredOrders();
        } catch (error) {
            console.error('❌ [RTO Inventory Service] Error getting unprocessed orders:', error.message);
            throw error;
        }
    }

    /**
     * Get processing status
     * @returns {Object} Current processing status
     */
    getStatus() {
        return {
            isProcessing: this.isProcessing,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = new RTOInventoryService();
