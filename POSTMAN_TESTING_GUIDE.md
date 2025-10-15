# 📮 Postman Testing Guide for Clamio Notifications

## 🚀 Quick Start

### **Step 1: Import Postman Collection**
1. Open Postman
2. Click "Import" button
3. Select `backend/postman/Clamio_Notifications_Collection.json`
4. The collection will be imported with all requests

### **Step 2: Set Environment Variables**
1. Click on the collection name
2. Go to "Variables" tab
3. Update these variables:
   - `admin_email`: Your admin email (e.g., `admin@clamio.com`)
   - `admin_password`: Your admin password
   - `base_url`: `http://localhost:5000/api`

### **Step 3: Test Basic Notification Creation**
1. Select "Create Test Notification - High"
2. Click "Send"
3. You should see a 201 response with notification details

## 📋 Available API Endpoints

### **1. Create Notification**
```http
POST {{base_url}}/notifications
Authorization: Basic {{encoded_credentials}}
Content-Type: application/json

{
  "type": "vendor_error",
  "severity": "high",
  "title": "Test Notification",
  "message": "Test message",
  "vendor_id": 1,
  "vendor_name": "Test Vendor",
  "order_id": "TEST123",
  "metadata": {
    "operation": "POST /api/notifications",
    "error_type": "test_error",
    "error_code": "POSTMAN_TEST"
  },
  "error_details": "Test error details"
}
```

### **2. Get All Notifications**
```http
GET {{base_url}}/notifications?page=1&limit=10
Authorization: Basic {{encoded_credentials}}
```

### **3. Get Notification Stats**
```http
GET {{base_url}}/notifications/stats
Authorization: Basic {{encoded_credentials}}
```

### **4. Resolve Notification**
```http
POST {{base_url}}/notifications/{id}/resolve
Authorization: Basic {{encoded_credentials}}
Content-Type: application/json

{
  "resolution_notes": "Issue resolved"
}
```

### **5. Get VAPID Key (Public)**
```http
GET {{base_url}}/public/vapid-key
```

### **6. Get Push Status**
```http
GET {{base_url}}/notifications/push-status
Authorization: Basic {{encoded_credentials}}
```

## 🔧 Manual Setup (Without Collection)

### **Authentication Setup**
1. **Type**: Basic Auth
2. **Username**: Your admin email
3. **Password**: Your admin password

### **Headers**
```
Content-Type: application/json
Authorization: Basic <base64_encoded_credentials>
```

### **Base64 Encoding**
You can encode your credentials using:
- Online tool: https://www.base64encode.org/
- Format: `email:password`
- Example: `admin@clamio.com:mypassword`

## 🧪 Test Scenarios

### **Scenario 1: Critical Error**
```json
{
  "type": "vendor_error",
  "severity": "critical",
  "title": "Critical System Error",
  "message": "Database connection failed",
  "vendor_id": 1,
  "vendor_name": "Test Vendor",
  "order_id": "CRIT123",
  "metadata": {
    "operation": "database_connection",
    "error_type": "connection_error",
    "error_code": "DB_CONN_001"
  },
  "error_details": "Unable to connect to database server"
}
```

### **Scenario 2: High Priority Alert**
```json
{
  "type": "vendor_error",
  "severity": "high",
  "title": "Payment Processing Error",
  "message": "Payment gateway timeout",
  "vendor_id": 2,
  "vendor_name": "Payment Vendor",
  "order_id": "PAY456",
  "metadata": {
    "operation": "payment_processing",
    "error_type": "gateway_timeout",
    "error_code": "PAY_TIMEOUT_001"
  },
  "error_details": "Payment gateway did not respond within 30 seconds"
}
```

### **Scenario 3: Medium Priority Warning**
```json
{
  "type": "vendor_error",
  "severity": "medium",
  "title": "Inventory Sync Warning",
  "message": "Slow inventory synchronization",
  "vendor_id": 3,
  "vendor_name": "Inventory Vendor",
  "order_id": "INV789",
  "metadata": {
    "operation": "inventory_sync",
    "error_type": "sync_delay",
    "error_code": "INV_SYNC_001"
  },
  "error_details": "Inventory sync is running 5 minutes behind schedule"
}
```

## 🎯 Expected Responses

### **Successful Notification Creation (201)**
```json
{
  "success": true,
  "message": "Notification created successfully",
  "id": 123,
  "status": "pending",
  "severity": "high",
  "title": "Test Notification",
  "created_at": "2024-01-15T10:30:00.000Z"
}
```

### **Get Notifications (200)**
```json
{
  "success": true,
  "notifications": [
    {
      "id": 123,
      "type": "vendor_error",
      "severity": "high",
      "title": "Test Notification",
      "status": "pending",
      "created_at": "2024-01-15T10:30:00.000Z",
      "vendor_name": "Test Vendor",
      "order_id": "TEST123"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  }
}
```

### **Get Stats (200)**
```json
{
  "success": true,
  "stats": {
    "total": 5,
    "pending": 3,
    "resolved": 2,
    "critical": 1,
    "high": 2,
    "medium": 2,
    "low": 0
  }
}
```

## 🚨 Troubleshooting

### **Error 401: Unauthorized**
- Check your admin credentials
- Verify base64 encoding is correct
- Ensure you're using Basic Auth

### **Error 400: Bad Request**
- Check JSON format
- Verify all required fields are present
- Check field types (vendor_id should be number)

### **Error 500: Server Error**
- Check if backend server is running
- Check server logs for detailed error messages
- Verify database connection

### **No Notifications Appearing**
- Check if notifications are being created (use GET endpoint)
- Verify admin panel is connected to same backend
- Check browser console for errors

## 🎮 Quick Test Script

You can also use the Node.js script I created:

```bash
# Update credentials in the script first
node backend/scripts/test-notification-creation.js
```

This will create multiple test notifications automatically.

## 💡 Tips

1. **Start Simple**: Begin with the basic "Create Test Notification - High" request
2. **Check Responses**: Always verify the response status and data
3. **Use Variables**: Set up environment variables for easy credential management
4. **Test Different Severities**: Try critical, high, medium, and low severity levels
5. **Verify in Admin Panel**: After creating notifications, check if they appear in your admin panel

## 🔍 Debugging

### **Check Server Logs**
```bash
# In backend directory
npm run dev
# Look for request logs and any errors
```

### **Check Database**
```sql
-- Check if notifications are being stored
SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10;
```

### **Check Browser Console**
- Open admin panel
- Press F12 to open developer tools
- Check console for any JavaScript errors
- Look for network requests to notification endpoints

Happy testing! 🚀
