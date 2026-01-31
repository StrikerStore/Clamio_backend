require('dotenv').config();
const database = require('../config/database');

async function test() {
    await database.waitForMySQLInitialization();

    // 1. Find a vendor who actually has claims
    const [vendorsWithClaims] = await database.mysqlPool.execute(
        "SELECT DISTINCT c.claimed_by, u.email FROM claims c JOIN users u ON c.claimed_by = u.warehouseId WHERE c.claimed_by IS NOT NULL LIMIT 1"
    );

    let vendor;
    if (vendorsWithClaims.length > 0) {
        vendor = vendorsWithClaims[0];
        console.log(`Found active vendor with claims: ${vendor.email} (WH: ${vendor.claimed_by})`);
    } else {
        // Fallback to any vendor
        const [allVendors] = await database.mysqlPool.execute(
            "SELECT email, warehouseId FROM users WHERE role = 'vendor' LIMIT 1"
        );
        if (allVendors.length === 0) {
            console.log('No vendors found at all.');
            process.exit(0);
        }
        vendor = { email: allVendors[0].email, claimed_by: allVendors[0].warehouseId };
        console.log(`No vendors with claims found. Using: ${vendor.email} (WH: ${vendor.claimed_by})`);
    }

    const options = {
        vendorId: vendor.claimed_by,
        dateFrom: '2020-01-01',
        dateTo: '2030-01-01'
    };

    try {
        console.log('\n--- Fulfillment Stats ---');
        const stats = await database.getVendorFulfillmentStats(options);
        console.log(JSON.stringify(stats, null, 2));

        console.log('\n--- Status Distribution ---');
        const dist = await database.getVendorStatusDistribution(options);
        console.log(JSON.stringify(dist, null, 2));

        console.log('\n--- Handover Trend ---');
        const trend = await database.getVendorHandoverTrend(options);
        console.log(JSON.stringify(trend, null, 2));

    } catch (error) {
        console.error('Error testing analytics logic:', error);
    }

    process.exit(0);
}

test();
