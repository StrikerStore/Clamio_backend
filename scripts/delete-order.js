/* eslint-disable no-console */
/**
 * Delete all records for a given order_id across relevant tables.
 * Usage: node scripts/delete-order.js <ORDER_ID>
 */
(async () => {
	try {
		// Load .env
		try {
			require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
		} catch (e) {}

		const orderId = process.argv[2];
		if (!orderId) {
			console.error('Usage: node scripts/delete-order.js <ORDER_ID>');
			process.exit(1);
		}

		const database = require('../config/database');
		await database.waitForMySQLInitialization();
		if (!database.isMySQLAvailable()) {
			console.error('MySQL not available');
			process.exit(1);
		}

		console.log('=== DELETE ORDER START ===');
		console.log('Order ID:', orderId);

		const conn = database.mysqlConnection || database.mysqlPool;
		if (!conn) {
			throw new Error('No MySQL connection');
		}

		// Helper to run delete and report affected rows
		async function del(sql, params) {
			const [res] = await conn.execute(sql, params);
			return res.affectedRows || 0;
		}

		// Collect unique_ids for this order to clean claims by order_unique_id if needed
		let uniqueIds = [];
		try {
			const [rows] = await conn.execute('SELECT unique_id FROM orders WHERE order_id = ?', [orderId]);
			uniqueIds = rows.map(r => r.unique_id);
		} catch (e) {}

		let total = 0;
		let count = 0;

		count = await del('DELETE FROM labels WHERE order_id = ?', [orderId]);
		console.log('labels:', count); total += count;

		// claims table may reference order_id and cloned_order_id and order_unique_id
		count = await del('DELETE FROM claims WHERE order_id = ?', [orderId]);
		console.log('claims (by order_id):', count); total += count;
		count = await del('DELETE FROM claims WHERE cloned_order_id = ?', [orderId]);
		console.log('claims (by cloned_order_id):', count); total += count;
		if (uniqueIds.length > 0) {
			const placeholders = uniqueIds.map(() => '?').join(',');
			const [res] = await conn.execute(`DELETE FROM claims WHERE order_unique_id IN (${placeholders})`, uniqueIds);
			count = res.affectedRows || 0;
			console.log('claims (by order_unique_id):', count); total += count;
		}

		count = await del('DELETE FROM customer_info WHERE order_id = ?', [orderId]);
		console.log('customer_info:', count); total += count;

		count = await del('DELETE FROM order_tracking WHERE order_id = ?', [orderId]);
		console.log('order_tracking:', count); total += count;

		// rto tables if present
		try {
			count = await del('DELETE FROM rto_tracking WHERE order_id = ?', [orderId]);
			console.log('rto_tracking:', count); total += count;
		} catch (e) {
			console.log('rto_tracking: table not found or error (skipped)');
		}
		try {
			count = await del('DELETE FROM rto_inventory WHERE order_id = ?', [orderId]);
			console.log('rto_inventory:', count); total += count;
		} catch (e) {
			console.log('rto_inventory: table not found or error (skipped)');
		}

		// clone transactions referencing this clone id
		try {
			count = await del('DELETE FROM clone_transactions WHERE clone_order_id = ?', [orderId]);
			console.log('clone_transactions (by clone_order_id):', count); total += count;
		} catch (e) {
			console.log('clone_transactions: table not found or error (skipped)');
		}

		// Finally, orders rows themselves
		count = await del('DELETE FROM orders WHERE order_id = ?', [orderId]);
		console.log('orders:', count); total += count;

		console.log('TOTAL DELETED ROWS:', total);
		console.log('=== DELETE ORDER END ===');
		process.exit(0);
	} catch (err) {
		console.error('Delete order script error:', err && err.message ? err.message : err);
		process.exit(1);
	}
})();

