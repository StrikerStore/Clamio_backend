const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../config/database');

/**
 * Diagnostic script to check the current state of shipment_id and partner_order_id
 * This helps understand what needs to be fixed on the next sync
 */

async function checkStatus() {
    console.log('════════════════════════════════════════════════════════════');
    console.log('📊 Checking shipment_id and partner_order_id Status');
    console.log('════════════════════════════════════════════════════════════\n');

    try {
        await database.waitForMySQLInitialization();

        if (!database.isMySQLAvailable()) {
            throw new Error('Database connection not available');
        }

        // Check orders where both columns have the same value (expected after migration)
        const [sameValue] = await database.mysqlConnection.execute(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE shipment_id IS NOT NULL 
            AND shipment_id != ''
            AND partner_order_id IS NOT NULL
            AND partner_order_id != ''
            AND shipment_id = partner_order_id
        `);

        // Check orders where partner_order_id is NULL
        const [nullPartnerOrderId] = await database.mysqlConnection.execute(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE (partner_order_id IS NULL OR partner_order_id = '')
            AND shipment_id IS NOT NULL
            AND shipment_id != ''
        `);

        // Check orders where both are NULL
        const [bothNull] = await database.mysqlConnection.execute(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE (shipment_id IS NULL OR shipment_id = '')
            AND (partner_order_id IS NULL OR partner_order_id = '')
        `);

        // Check orders where shipment_id is NULL but partner_order_id has value
        const [shipmentNull] = await database.mysqlConnection.execute(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE (shipment_id IS NULL OR shipment_id = '')
            AND partner_order_id IS NOT NULL
            AND partner_order_id != ''
        `);

        // Check total orders with shipment_id
        const [totalWithShipmentId] = await database.mysqlConnection.execute(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE shipment_id IS NOT NULL AND shipment_id != ''
        `);

        // Check total orders with partner_order_id
        const [totalWithPartnerOrderId] = await database.mysqlConnection.execute(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE partner_order_id IS NOT NULL AND partner_order_id != ''
        `);

        console.log('📊 Current Status Summary:\n');
        console.log(`   Total orders with shipment_id: ${totalWithShipmentId[0].count}`);
        console.log(`   Total orders with partner_order_id: ${totalWithPartnerOrderId[0].count}\n`);
        
        console.log('📋 Breakdown:\n');
        console.log(`   ✅ Orders where both columns have same value (expected after migration): ${sameValue[0].count}`);
        console.log(`      → These will be fixed on next sync: shipment_id will get shipment.id, partner_order_id keeps order.id\n`);
        
        console.log(`   ⚠️  Orders where partner_order_id is NULL (but shipment_id exists): ${nullPartnerOrderId[0].count}`);
        console.log(`      → These will be fixed on next sync: partner_order_id will get order.id from API\n`);
        
        console.log(`   ⚠️  Orders where shipment_id is NULL (but partner_order_id exists): ${shipmentNull[0].count}`);
        console.log(`      → These will be fixed on next sync: shipment_id will get shipment.id from API\n`);
        
        console.log(`   ⚠️  Orders where both are NULL: ${bothNull[0].count}`);
        console.log(`      → These will be fixed on next sync: both will be populated from API\n`);

        // Show sample of records with NULL partner_order_id
        if (nullPartnerOrderId[0].count > 0) {
            console.log('\n📋 Sample records with NULL partner_order_id:\n');
            const [samples] = await database.mysqlConnection.execute(`
                SELECT unique_id, order_id, shipment_id, partner_order_id, account_code
                FROM orders
                WHERE (partner_order_id IS NULL OR partner_order_id = '')
                AND shipment_id IS NOT NULL
                AND shipment_id != ''
                LIMIT 5
            `);
            
            samples.forEach((row, idx) => {
                console.log(`   ${idx + 1}. Order: ${row.order_id}, shipment_id: ${row.shipment_id}, partner_order_id: NULL`);
            });
            
            if (nullPartnerOrderId[0].count > 5) {
                console.log(`   ... and ${nullPartnerOrderId[0].count - 5} more`);
            }
        }

        console.log('\n════════════════════════════════════════════════════════════');
        console.log('💡 What will happen on next sync:');
        console.log('════════════════════════════════════════════════════════════\n');
        console.log('   1. For orders where both columns have same value:');
        console.log('      → shipment_id will be updated with shipment.id from order.shipments[0].id');
        console.log('      → partner_order_id will keep order.id (already correct)\n');
        console.log('   2. For orders with NULL partner_order_id:');
        console.log('      → partner_order_id will be populated with order.id from API');
        console.log('      → shipment_id will be updated with shipment.id from API\n');
        console.log('   3. For orders with NULL shipment_id:');
        console.log('      → shipment_id will be populated with shipment.id from API (if shipments exist)');
        console.log('      → partner_order_id will be populated with order.id from API\n');
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

// Run the check
checkStatus();
