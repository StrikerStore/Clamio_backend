/* eslint-disable no-console */
/**
 * Debug script: Inspect order data across accounts for a given order_id.
 * Usage: node scripts/debug-order.js <ORDER_ID>
 */
(async () => {
	try {
		// Load environment variables from .env in backend root
		try {
			require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
		} catch (e) {
			// non-blocking
		}

		const orderId = process.argv[2];
		if (!orderId) {
			console.error('Usage: node scripts/debug-order.js <ORDER_ID>');
			process.exit(1);
		}

		const database = require('../config/database');
		await database.waitForMySQLInitialization();
		if (!database.isMySQLAvailable()) {
			console.error('MySQL not available');
			process.exit(1);
		}

		console.log('=== DEBUG ORDER REPORT ===');
		console.log('Order ID:', orderId);

		// Pull enriched orders view
		const orders = await database.getAllOrders();
		const rows = orders.filter(o => o.order_id === orderId);

		if (rows.length === 0) {
			console.log('No order rows found in orders view for this order_id.');
		} else {
			const accounts = [...new Set(rows.map(r => r.account_code).filter(Boolean))];
			console.log('\nAccounts involved:', accounts.join(', ') || '(none)');
			console.log('Total order rows:', rows.length);

			for (const acc of accounts) {
				const accRows = rows.filter(r => r.account_code === acc);
				const claimedByVendors = [...new Set(accRows.map(r => r.claimed_by).filter(Boolean))];
				const statuses = [...new Set(accRows.map(r => r.status))];
				const claimStatuses = [...new Set(accRows.map(r => r.claims_status))];
				const productCodes = accRows.map(r => r.product_code);

				console.log(`\n— Account: ${acc}`);
				console.log('  Rows:', accRows.length);
				console.log('  Vendors claiming:', claimedByVendors.length ? claimedByVendors.join(', ') : '(none)');
				console.log('  Statuses:', statuses.join(', '));
				console.log('  Claim statuses:', claimStatuses.join(', '));
				console.log('  Products:', productCodes.join(', '));
			}
		}

		// Labels by account
		const labelsByAccount = {};
		{
			// Try to infer accounts from orders; if none, try all labels for that order_id
			const inferredAccounts = [...new Set(rows.map(r => r.account_code).filter(Boolean))];
			if (inferredAccounts.length > 0) {
				for (const acc of inferredAccounts) {
					const label = await database.getLabelByOrderId(orderId, acc);
					if (label) labelsByAccount[acc] = label;
				}
			} else {
				// Fallback: query labels without account filter and group afterward
				const [labels] = await database.mysqlConnection.execute(
					'SELECT * FROM labels WHERE order_id = ?',
					[orderId]
				);
				for (const l of labels) {
					labelsByAccount[l.account_code || 'unknown'] = l;
				}
			}
		}

		console.log('\nLabels:');
		if (Object.keys(labelsByAccount).length === 0) {
			console.log('  (none)');
		} else {
			for (const [acc, l] of Object.entries(labelsByAccount)) {
				console.log(`  ${acc}: awb=${l.awb || '(null)'} url=${l.label_url ? 'yes' : 'no'} is_handover=${l.is_handover || 0}`);
			}
		}

		// Customer info per account (scoped)
		console.log('\nCustomer Info:');
		const accountsForCI = [...new Set(rows.map(r => r.account_code).filter(Boolean))];
		if (accountsForCI.length === 0) {
			console.log('  (no accounts inferred from orders)');
			const ci = await database.getCustomerInfoByOrderId(orderId);
			if (ci) {
				console.log(`  (unscoped) email=${ci.email || ''} phone=${ci.shipping_phone || ci.billing_phone || ''} store_code=${ci.store_code || ''}`);
			} else {
				console.log('  (none)');
			}
		} else {
			for (const acc of accountsForCI) {
				const ci = await database.getCustomerInfoByOrderId(orderId, acc);
				if (ci) {
					console.log(`  ${acc}: email=${ci.email || ''} phone=${ci.shipping_phone || ci.billing_phone || ''} store_code=${ci.store_code || ''}`);
				} else {
					console.log(`  ${acc}: (none)`);
				}
			}
		}

		// Claims summary
		console.log('\nClaims:');
		if (rows.length === 0) {
			console.log('  (no rows)');
		} else {
			const byAccount = rows.reduce((m, r) => {
				const k = r.account_code || 'unknown';
				(m[k] = m[k] || []).push(r);
				return m;
			}, {});
			for (const [acc, list] of Object.entries(byAccount)) {
				const claimed = list.filter(r => r.claimed_by && r.claims_status === 'claimed');
				const vendors = [...new Set(claimed.map(r => r.claimed_by))];
				console.log(`  ${acc}: claimedRows=${claimed.length} vendors=${vendors.join(', ') || '(none)'}`);
			}
		}

		console.log('\n=== END REPORT ===');
		process.exit(0);
	} catch (err) {
		console.error('Debug script error:', err && err.message ? err.message : err);
		process.exit(1);
	}
})();

