# Customer Message Tracking & Webhook Implementation - Summary

## ✅ Completed Implementation

All components have been successfully implemented as planned:

### 1. Database Layer ✅

#### **`customer_message_tracking` Table**
- Created table to track message statuses for each order
- Columns: `id`, `order_id`, `account_code`, `message_status`, `sent_at`, `created_at`
- Indexes on `(order_id, account_code)` and `sent_at`
- Automatically created on server startup

#### **Database Methods Added**
- `createCustomerMessageTrackingTable()` - Table creation
- `insertCustomerMessageTracking(orderId, accountCode, messageStatus)` - Insert new record
- `getLatestMessageStatusByOrders(orderAccountPairs)` - Bulk fetch latest status
- `getUtilityValue(parameter)` - Get webhook URL from utility table
- `setUtilityValue(parameter, value)` - Set/update utility parameters

### 2. Webhook Service ✅

**File:** `backend/services/webhookService.js`

- Fetches webhook URL from `utility` table (`OrderStatusWebhookUrl` parameter)
- Collects order data: carrier_id, order_id, awb, current_shipment_status
- Fetches customer info: shipping_phone, shipping_firstname, shipping_lastname
- Fetches order product data: number_of_product (distinct count), number_of_quantity (sum)
- Includes latest message_status from customer_message_tracking table
- Sends POST request to configured webhook URL
- Graceful error handling (logs but doesn't break sync)

**Payload Format:**
```json
{
  "timestamp": "2026-02-04T02:00:00.000Z",
  "event": "status_update",
  "orders": [
    {
      "order_id": "12345",
      "account_code": "STORE001",
      "carrier_id": "C123",
      "awb": "AWB12345",
      "current_shipment_status": "In Transit",
      "previous_status": "Shipment Booked",
      "shipping_phone": "+91XXXXXXXXXX",
      "shipping_firstname": "John",
      "shipping_lastname": "Doe",
      "number_of_product": 2,
      "number_of_quantity": 5,
      "latest_message_status": "pending"
    }
  ]
}
```

**Field Descriptions:**
- `number_of_product`: Count of distinct products for this order (from `orders` table)
- `number_of_quantity`: Sum of all product quantities for this order (from `orders` table)

### 3. Order Tracking Service Modifications ✅

**File:** `backend/services/orderTrackingService.js`

**Changes to `processOrderTrackingWithData()`:**
- Fetches current status from labels table before update
- Detects if status changed
- Returns `statusChanged`, `oldStatus`, `order_id`, `account_code` in response

**Changes to `syncActiveOrderTracking()`:**
- Collects all orders with status changes during sync
- Triggers webhook after sync completion (after validation check)
- Webhook only sent if there are status changes
- Logs webhook results

### 4. API Routes ✅

**File:** `backend/routes/orders.js`

#### **POST `/api/orders/message-tracking`**
- **Auth:** Basic Auth (same as other APIs)
- **Purpose:** Record customer message tracking status
- **Request Body:**
  ```json
  {
    "order_id": "12345",
    "account_code": "STORE001",
    "message_status": "sent"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "Message tracking record created",
    "data": {
      "id": 123,
      "order_id": "12345",
      "account_code": "STORE001",
      "message_status": "sent",
      "sent_at": "2026-02-04T02:00:00.000Z"
    }
  }
  ```

#### **POST `/api/orders/trigger-webhook`**
- **Auth:** Admin/Superadmin only
- **Purpose:** Manual webhook testing
- **Request Body:**
  ```json
  {
    "order_ids": ["12345", "67890"]
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "Webhook triggered successfully",
    "data": {
      "orders": [...],
      "webhookResult": {...}
    }
  }
  ```

---

## 📋 Setup Instructions

### 1. Configure Webhook URL

Insert the webhook URL into the `utility` table:

```sql
INSERT INTO utility (parameter, value, created_by)
VALUES ('OrderStatusWebhookUrl', 'https://your-webhook-endpoint.com/status-update', 'admin')
ON DUPLICATE KEY UPDATE value = 'https://your-webhook-endpoint.com/status-update';
```

Or use the database method:
```javascript
await database.setUtilityValue('OrderStatusWebhookUrl', 'https://your-webhook-endpoint.com/status-update', 'admin');
```

### 2. Configure Retry Count (Optional)

Set the number of retry attempts for failed webhooks (default: 3):

```sql
INSERT INTO utility (parameter, value, created_by)
VALUES ('WebhookRetryCount', '3', 'admin')
ON DUPLICATE KEY UPDATE value = '3';
```

**Retry Behavior:**
- **Timeout:** 30 seconds per attempt
- **Exponential Backoff:** 1s, 2s, 4s... between retries
- **Default Retry Count:** 3 (if not configured)

### 3. Restart Server

The `customer_message_tracking` table will be created automatically on server startup.

---

## 🧪 Testing

### Test Message Tracking API

```bash
curl -X POST http://localhost:5000/api/orders/message-tracking \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic <your-base64-token>" \
  -d '{
    "order_id": "TEST123",
    "account_code": "STORE001",
    "message_status": "sent"
  }'
```

### Test Manual Webhook Trigger

```bash
curl -X POST http://localhost:5000/api/orders/trigger-webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic <your-admin-token>" \
  -d '{
    "order_ids": ["12345", "67890"]
  }'
```

### Monitor Webhook in Cron

The webhook will automatically trigger after the hourly Active Orders Tracking cron job completes. Check server logs for:
- `📤 [Webhook] Triggering webhook for X orders with status changes...`
- `✅ [Webhook] Successfully sent: ...`

---

## 📊 Data Flow

```
Hourly Cron (every hour at :00)
  ↓
syncActiveOrderTracking()
  ↓
Batch fetch tracking from Shipway API (50 AWBs/call)
  ↓
processOrderTrackingWithData() for each order
  ↓
Check if current_shipment_status changed
  ↓
If changed: Add to statusChangedOrders array
  ↓
After all orders processed:
  ↓
webhookService.sendStatusUpdateWebhook(statusChangedOrders)
  ↓
Fetch additional data (customer_info, labels, order stats, message_status)
  ↓
POST to webhook URL configured in utility table
```

---

## 🔧 Key Features

✅ **Table created automatically** on server startup  
✅ **Webhook URL configurable** via utility table  
✅ **Bulk data fetching** for efficiency  
✅ **Status change detection** - only sends updates when status changes  
✅ **Retry with exponential backoff** - configurable retry count (default: 3)  
✅ **30-second timeout** per webhook attempt  
✅ **Graceful error handling** - webhook failures don't break sync  
✅ **Manual testing endpoint** for development  
✅ **Basic auth** on message tracking API  
✅ **Admin-only** webhook trigger endpoint  

---

## 📝 Notes

- Webhook URL should be set in the `utility` table before the first cron run
- The webhook is triggered **automatically** every hour during the Active Orders sync
- Use the manual trigger endpoint for testing without waiting for the cron
- All webhook failures are logged but don't affect the order tracking sync
- Message status tracking is independent - can be updated anytime via API
