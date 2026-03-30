const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function main() {
  const orderId = '255351_1';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await conn.query(
    `SELECT
      o.unique_id,
      o.order_id,
      o.account_code,
      o.product_name,
      o.product_code,
      o.quantity,
      c.status AS claim_status,
      c.claimed_by,
      c.claimed_at,
      c.clone_status,
      c.cloned_order_id,
      c.is_cloned_row,
      c.label_downloaded,
      l.awb,
      l.label_url,
      l.current_shipment_status,
      l.is_manifest,
      l.is_handover
    FROM orders o
    LEFT JOIN claims c
      ON o.unique_id = c.order_unique_id
     AND o.account_code = c.account_code
    LEFT JOIN labels l
      ON o.order_id = l.order_id
     AND o.account_code = l.account_code
    WHERE o.order_id = ?
    ORDER BY o.unique_id`,
    [orderId]
  );

  const [cnt] = await conn.query(
    'SELECT COUNT(*) AS row_count, COALESCE(SUM(quantity), 0) AS total_qty FROM orders WHERE order_id = ?',
    [orderId]
  );

  const [ci] = await conn.query(
    `SELECT
      order_id,
      account_code,
      store_code,
      billing_firstname,
      billing_phone
    FROM customer_info
    WHERE order_id = ?`,
    [orderId]
  );

  console.log('--- PRE-CHECK SNAPSHOT ---');
  console.log('order_id:', orderId);
  console.log('rows_in_orders:', cnt[0].row_count, 'total_qty:', cnt[0].total_qty);
  console.log('customer_info_rows:', ci.length);
  console.log('customer_info:', ci);
  console.log('order_rows:', rows);

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

