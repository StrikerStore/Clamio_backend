const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

/**
 * Fix script to update orders where partner_order_id is NULL but shipment_id exists
 * This handles edge cases that might have been missed by the migration
 */

async function fixNullPartnerOrderId() {
    console.log('════════════════════════════════════════════════════════════');
    console.log('🔧 Fixing NULL partner_order_id values');
    console.log('════════════════════════════════════════════════════════════\n');

    try {
        await database.waitForMySQLInitialization();

        if (!database.isMySQLAvailable()) {
            throw new Error('Database connection not available');
        }

        // Find orders where partner_order_id is NULL but shipment_id exists
        const [candidates] = await database.mysqlConnection.execute(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE (partner_order_id IS NULL OR partner_order_id = '')
            AND shipment_id IS NOT NULL
            AND shipment_id != ''
        `);

        const totalCount = candidates[0].count;
        console.log(`📋 Found ${totalCount} orders with NULL partner_order_id but existing shipment_id\n`);

        if (totalCount === 0) {
            console.log('✅ No orders need fixing!\n');
            console.log('════════════════════════════════════════════════════════════\n');
            return;
        }

        // Show which orders will be fixed
        const [samples] = await database.mysqlConnection.execute(`
            SELECT unique_id, order_id, shipment_id, partner_order_id, account_code
            FROM orders
            WHERE (partner_order_id IS NULL OR partner_order_id = '')
            AND shipment_id IS NOT NULL
            AND shipment_id != ''
            LIMIT 10
        `);

        console.log('📋 Orders to be fixed:\n');
        samples.forEach((row, idx) => {
            console.log(`   ${idx + 1}. Order: ${row.order_id}, shipment_id: ${row.shipment_id}, partner_order_id: NULL`);
        });
        if (totalCount > 10) {
            console.log(`   ... and ${totalCount - 10} more\n`);
        } else {
            console.log('');
        }

        // Update partner_order_id = shipment_id for these records
        // Note: This assumes shipment_id currently contains order.id (which it does after migration)
        // On next sync, shipment_id will be updated with shipment.id and partner_order_id will keep order.id
        const [result] = await database.mysqlConnection.execute(`
            UPDATE orders
            SET partner_order_id = shipment_id
            WHERE (partner_order_id IS NULL OR partner_order_id = '')
            AND shipment_id IS NOT NULL
            AND shipment_id != ''
        `);

        const fixedCount = result.affectedRows;
        console.log(`✅ Fixed ${fixedCount} orders\n`);
        console.log('   Note: On next sync, shipment_id will be updated with shipment.id from API');
        console.log('         and partner_order_id will keep order.id (which is correct)\n');

        console.log('════════════════════════════════════════════════════════════');
        console.log('📊 Summary:');
        console.log(`   - Orders fixed: ${fixedCount}`);
        console.log('   - partner_order_id now set to shipment_id (which contains order.id)');
        console.log('   - Both will be correctly separated on next sync');
        console.log('════════════════════════════════════════════════════════════\n');

        process.exit(0);

    } catch (error) {
        console.error('\n════════════════════════════════════════════════════════════');
        console.error('💥 Error:', error.message);
        console.error('════════════════════════════════════════════════════════════\n');
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Run the fix
fixNullPartnerOrderId();
