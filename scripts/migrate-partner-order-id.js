const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

/**
 * ONE-TIME MIGRATION SCRIPT
 * Migrates existing data to fix shipment_id and partner_order_id storage:
 * 1. Adds partner_order_id column if it doesn't exist
 * 2. Sets partner_order_id = shipment_id for existing records (since shipment_id currently has order.id)
 * 3. Note: shipment_id will be updated correctly on next sync when API is called
 * 
 * This script is idempotent - safe to run multiple times.
 */

async function runMigration() {
    const migrationName = '2026-02-26_fix_shipment_id_and_partner_order_id';
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

        console.log('📋 Step 1: Ensuring partner_order_id column exists...\n');

        // Ensure partner_order_id column exists
        await database.addShiprocketColumnsIfNotExists();

        // Check if column exists
        const [columns] = await database.mysqlConnection.execute(`
            SHOW COLUMNS FROM orders LIKE 'partner_order_id'
        `);

        if (columns.length === 0) {
            throw new Error('partner_order_id column was not created. Please check database permissions.');
        }

        console.log('✅ partner_order_id column exists\n');

        console.log('📋 Step 2: Finding orders with shipment_id but no partner_order_id...\n');

        // Find orders that have shipment_id but partner_order_id is NULL
        const [candidates] = await database.mysqlConnection.execute(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE shipment_id IS NOT NULL AND shipment_id != '' AND (partner_order_id IS NULL OR partner_order_id = '')
        `);

        const totalCount = candidates[0].count;
        console.log(`   Found ${totalCount} orders to migrate\n`);

        if (totalCount === 0) {
            console.log('✅ No orders need migration!\n');

            // Mark migration as complete
            await database.mysqlConnection.execute(`
                INSERT INTO utility (parameter, value, created_by)
                VALUES (?, ?, 'migration_script')
            `, [`migration_${migrationName}`, JSON.stringify({
                completed_at: new Date().toISOString(),
                orders_migrated: 0,
                message: 'No orders needed migration'
            })]);

            console.log('════════════════════════════════════════════════════════════');
            return;
        }

        console.log('📋 Step 3: Migrating data (setting partner_order_id = shipment_id)...\n');

        // Update partner_order_id = shipment_id for existing records
        // This is correct because shipment_id currently stores order.id
        const [result] = await database.mysqlConnection.execute(`
            UPDATE orders
            SET partner_order_id = shipment_id
            WHERE shipment_id IS NOT NULL AND shipment_id != '' AND (partner_order_id IS NULL OR partner_order_id = '')
        `);

        const migratedCount = result.affectedRows;
        console.log(`✅ Migrated ${migratedCount} orders\n`);
        console.log('   Note: shipment_id will be updated correctly on next sync when API is called\n');

        console.log('════════════════════════════════════════════════════════════');
        console.log('📊 Migration Summary:');
        console.log(`   - Orders migrated: ${migratedCount}`);
        console.log(`   - partner_order_id now contains order.id (from Shiprocket API)`);
        console.log(`   - shipment_id will be updated to shipment.id on next sync`);
        console.log('════════════════════════════════════════════════════════════\n');

        // Mark migration as complete
        await database.mysqlConnection.execute(`
            INSERT INTO utility (parameter, value, created_by)
            VALUES (?, ?, 'migration_script')
        `, [`migration_${migrationName}`, JSON.stringify({
            completed_at: new Date().toISOString(),
            orders_migrated: migratedCount,
            message: 'Migration completed successfully. shipment_id will be updated on next sync.'
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
