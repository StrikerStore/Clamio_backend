/**
 * Migration Script: Recalculate collectable amounts with quantity-based ratios
 * 
 * This script recalculates order_total_ratio, order_total_split, prepaid_amount, 
 * and collectable_amount for all existing orders using the new formula that 
 * includes quantity in the ratio calculation.
 * 
 * Previous logic: ratio based on selling_price only
 * New logic: ratio based on (selling_price × quantity)
 * 
 * Run this ONCE after deploying the updated shipwayService.js
 * 
 * Usage: node backend/scripts/recalculate-collectable-amounts.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const DB_CONFIG = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'clamio_db',
    charset: 'utf8mb4'
};

// GCD function for simplifying ratios
const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
const findGCD = (arr) => arr.filter(v => v > 0).reduce((acc, val) => gcd(acc, val), arr.find(v => v > 0) || 1);

async function runMigration() {
    let connection;

    try {
        console.log('🚀 Starting migration: Recalculate collectable amounts with quantity-based ratios');
        console.log('⚠️  This will update order_total_ratio, order_total_split, prepaid_amount, and collectable_amount');
        console.log('');

        // Connect to database
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('✅ Connected to database');

        // Step 1: Get all unique order groups (by order_id and account_code)
        console.log('\n📋 Step 1: Fetching all order groups...');
        const [orderGroups] = await connection.execute(`
      SELECT DISTINCT order_id, account_code 
      FROM orders 
      WHERE order_id IS NOT NULL
      ORDER BY order_id
    `);
        console.log(`✅ Found ${orderGroups.length} order groups to process`);

        if (orderGroups.length === 0) {
            console.log('No orders to process. Migration complete.');
            return;
        }

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        // Step 2: Process each order group
        console.log('\n🔄 Step 2: Processing orders...');

        for (let i = 0; i < orderGroups.length; i++) {
            const { order_id, account_code } = orderGroups[i];

            try {
                // Get all products for this order
                const [products] = await connection.execute(`
          SELECT unique_id, selling_price, quantity, order_total, payment_type, is_partial_paid
          FROM orders 
          WHERE order_id = ? AND account_code = ?
          ORDER BY unique_id
        `, [order_id, account_code]);

                if (products.length === 0) {
                    skippedCount++;
                    continue;
                }

                // Get order_total from first product (same for all products in order)
                const orderTotal = parseFloat(products[0].order_total) || 0;
                const paymentType = products[0].payment_type || 'P';
                const isPartialPaid = Boolean(products[0].is_partial_paid);

                if (orderTotal === 0) {
                    skippedCount++;
                    continue;
                }

                // Calculate total prepaid amount for the entire order based on payment type
                let totalPrepaidAmount = 0;
                if (paymentType === 'P') {
                    // Fully prepaid: 100% of order total
                    totalPrepaidAmount = orderTotal;
                } else if (paymentType === 'C' && isPartialPaid) {
                    // Partial prepaid COD: 10% of order total
                    totalPrepaidAmount = parseFloat((orderTotal * 0.1).toFixed(2));
                } else {
                    // Pure COD: 0% prepaid
                    totalPrepaidAmount = 0;
                }

                // Calculate value (price × quantity) for each product - NEW LOGIC
                const values = products.map(prod => {
                    const price = parseFloat(prod.selling_price) || 0;
                    const qty = parseInt(prod.quantity) || 1;
                    return price * qty;
                });

                // Calculate total value
                const totalValue = values.reduce((sum, val) => sum + val, 0);

                if (totalValue === 0) {
                    skippedCount++;
                    continue;
                }

                // Convert values to integers for GCD calculation
                const intValues = values.map(val => Math.round(val * 100));

                // Find GCD to get simplest ratio
                const valuesGCD = findGCD(intValues);

                // Calculate ratios
                const productRatios = valuesGCD > 0
                    ? intValues.map(val => Math.round(val / valuesGCD))
                    : values.map(() => 1);

                const totalRatios = productRatios.reduce((sum, ratio) => sum + ratio, 0);

                // Update each product in this order
                for (let j = 0; j < products.length; j++) {
                    const product = products[j];
                    const ratio = productRatios[j] || 1;

                    // Calculate splits
                    const orderTotalSplit = totalRatios > 0
                        ? parseFloat(((ratio / totalRatios) * orderTotal).toFixed(2))
                        : parseFloat((orderTotal / products.length).toFixed(2));

                    const prepaidAmount = totalRatios > 0
                        ? parseFloat(((ratio / totalRatios) * totalPrepaidAmount).toFixed(2))
                        : parseFloat((totalPrepaidAmount / products.length).toFixed(2));

                    // Calculate collectable amount
                    let collectableAmount = 0;
                    if (paymentType === 'P') {
                        collectableAmount = 0;
                    } else if (paymentType === 'C' && isPartialPaid) {
                        collectableAmount = parseFloat((orderTotalSplit - prepaidAmount).toFixed(2));
                    } else if (paymentType === 'C' && !isPartialPaid) {
                        collectableAmount = parseFloat(orderTotalSplit.toFixed(2));
                    }

                    // Update the order
                    await connection.execute(`
            UPDATE orders 
            SET order_total_ratio = ?,
                order_total_split = ?,
                prepaid_amount = ?,
                collectable_amount = ?
            WHERE unique_id = ?
          `, [ratio, orderTotalSplit, prepaidAmount, collectableAmount, product.unique_id]);

                    updatedCount++;
                }

                // Progress update every 100 orders
                if ((i + 1) % 100 === 0) {
                    console.log(`   Processed ${i + 1}/${orderGroups.length} order groups...`);
                }

            } catch (orderError) {
                console.error(`   ❌ Error processing order ${order_id}: ${orderError.message}`);
                errorCount++;
            }
        }

        // Summary
        console.log('\n📊 Migration Summary:');
        console.log(`   ✅ Updated: ${updatedCount} order rows`);
        console.log(`   ⏭️  Skipped: ${skippedCount} order groups (no products or zero values)`);
        console.log(`   ❌ Errors: ${errorCount} order groups`);
        console.log('\n🎉 Migration completed successfully!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

// Run migration if called directly
if (require.main === module) {
    runMigration()
        .then(() => {
            console.log('\n✅ Migration script completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Migration script failed:', error);
            process.exit(1);
        });
}

module.exports = { runMigration };
