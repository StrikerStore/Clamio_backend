/**
 * Vendor Error Tracking Service
 * Automatically creates notifications for vendor panel errors
 */

const database = require('../config/database');
const pushNotificationService = require('./pushNotificationService');

class VendorErrorTrackingService {
  constructor() {
    console.log('🔍 Vendor Error Tracking Service initialized');
  }

  /**
   * Track and create notification for vendor operation errors
   */
  async trackVendorError(errorData) {
    try {
      const {
        vendorId,
        vendorName,
        operation,
        error,
        orderId,
        orderIds,
        severity = 'medium',
        metadata = {},
        context = {}
      } = errorData;

      // Determine notification type based on operation
      const notificationType = this.getNotificationType(operation, error);
      
      // Determine severity based on error type and operation
      const finalSeverity = this.determineSeverity(operation, error, severity);

      // Create notification title and message
      const { title, message } = this.createNotificationContent(operation, error, orderId, vendorName);

      // Prepare notification data
      const notificationData = {
        type: notificationType,
        severity: finalSeverity,
        title,
        message,
        order_id: orderId || (orderIds && orderIds.length > 0 ? orderIds.join(', ') : null),
        vendor_id: vendorId,
        vendor_name: vendorName,
        vendor_warehouse_id: context.warehouseId,
        metadata: {
          operation,
          error_type: error.type || 'unknown',
          error_code: error.code || null,
          error_message: error.message,
          stack_trace: error.stack || null,
          user_agent: context.userAgent || null,
          timestamp: new Date().toISOString(),
          ...metadata
        },
        error_details: this.formatErrorDetails(error, context)
      };

      console.log('📢 Creating vendor error notification:', notificationData.title);

      // Create notification in database
      const query = `
        INSERT INTO notifications 
        (type, severity, title, message, order_id, vendor_id, vendor_name, vendor_warehouse_id, metadata, error_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        notificationData.type,
        notificationData.severity,
        notificationData.title,
        notificationData.message,
        notificationData.order_id,
        notificationData.vendor_id,
        notificationData.vendor_name,
        notificationData.vendor_warehouse_id,
        JSON.stringify(notificationData.metadata),
        notificationData.error_details
      ];

      const result = await database.query(query, params);
      console.log('✅ Vendor error notification created with ID:', result.insertId);

      // Get the created notification
      const [newNotification] = await database.query(
        'SELECT * FROM notifications WHERE id = ?',
        [result.insertId]
      );

      // Send push notification to all subscribed admins
      try {
        const pushResult = await pushNotificationService.sendNotificationToAllAdmins(newNotification);
        console.log('📱 Push notification sent for vendor error:', pushResult.sentCount, 'admins notified');
      } catch (pushError) {
        console.error('❌ Error sending push notification for vendor error:', pushError);
        // Don't fail the error tracking if push fails
      }

      return {
        success: true,
        notificationId: result.insertId,
        notification: newNotification
      };

    } catch (error) {
      console.error('❌ Error tracking vendor error:', error);
      throw error;
    }
  }

  /**
   * Determine notification type based on operation and error - Enhanced for dynamic categorization
   */
  getNotificationType(operation, error) {
    // First, try to get type based on error type (more specific)
    const errorTypeMap = {
      'AUTHENTICATION_ERROR': 'authentication_error',
      'PERMISSION_ERROR': 'authentication_error',
      'VALIDATION_ERROR': 'vendor_validation_error',
      'DATABASE_ERROR': 'vendor_api_error',
      'NETWORK_ERROR': 'vendor_connection_error',
      'TIMEOUT_ERROR': 'vendor_timeout_error',
      'SERVER_ERROR': 'vendor_api_error',
      'CONNECTION_ERROR': 'vendor_connection_error',
      'NOT_FOUND_ERROR': 'vendor_operation_error',
      'RATE_LIMIT_ERROR': 'vendor_operation_error',
      'CLIENT_ERROR': 'vendor_operation_error',
      'UNKNOWN_ERROR': 'vendor_operation_error'
    };

    // If error type is mapped, use it
    if (error.type && errorTypeMap[error.type]) {
      return errorTypeMap[error.type];
    }

    // Fallback to operation-based mapping
    const operationTypeMap = {
      // Order operations
      'claim_order': 'order_claim_error',
      'bulk_claim_orders': 'order_claim_error',
      'reverse_order': 'reverse_order_failure',
      'bulk_reverse_orders': 'reverse_order_failure',
      'mark_ready': 'order_processing_error',
      'bulk_mark_ready': 'order_processing_error',
      'download_label': 'label_download_error',
      'bulk_download_labels': 'label_download_error',
      
      // Authentication operations
      'login': 'authentication_error',
      'token_refresh': 'authentication_error',
      
      // Data operations
      'fetch_orders': 'data_fetch_error',
      'refresh_orders': 'data_refresh_error',
      'fetch_grouped_orders': 'data_fetch_error',
      'fetch_payments': 'data_fetch_error',
      'fetch_settlements': 'data_fetch_error',
      'fetch_transactions': 'data_fetch_error',
      
      // Settlement operations
      'create_settlement_request': 'settlement_error',
      'upload_payment_proof': 'settlement_error',
      
      // Address operations
      'fetch_address': 'address_error',
      'update_address': 'address_error',
      
      // File operations
      'upload_file': 'file_upload_error',
      'download_file': 'file_download_error'
    };

    return operationTypeMap[operation] || 'vendor_operation_error';
  }

  /**
   * Determine severity based on operation and error - Enhanced for dynamic severity assignment
   */
  determineSeverity(operation, error, defaultSeverity) {
    // Critical operations that affect order processing
    const criticalOperations = [
      'claim_order', 'bulk_claim_orders', 'reverse_order', 'bulk_reverse_orders'
    ];

    // High severity operations
    const highSeverityOperations = [
      'mark_ready', 'bulk_mark_ready', 'download_label', 'bulk_download_labels'
    ];

    // Enhanced error type severity mapping
    const errorSeverityMap = {
      'AUTHENTICATION_ERROR': 'critical',
      'PERMISSION_ERROR': 'critical',
      'DATABASE_ERROR': 'critical',
      'NETWORK_ERROR': 'high',
      'TIMEOUT_ERROR': 'high',
      'CONNECTION_ERROR': 'high',
      'SERVER_ERROR': 'critical',
      'VALIDATION_ERROR': 'medium',
      'NOT_FOUND_ERROR': 'medium',
      'RATE_LIMIT_ERROR': 'medium',
      'CLIENT_ERROR': 'medium',
      'UNKNOWN_ERROR': 'high'
    };

    // Check error type severity first (most specific)
    if (error.type && errorSeverityMap[error.type]) {
      return errorSeverityMap[error.type];
    }

    // Check operation criticality
    if (criticalOperations.includes(operation)) {
      return 'critical';
    }

    if (highSeverityOperations.includes(operation)) {
      return 'high';
    }

    // Check HTTP status code severity
    if (error.code) {
      if (error.code >= 500) return 'critical';
      if (error.code === 401 || error.code === 403) return 'critical';
      if (error.code === 404 || error.code === 422) return 'medium';
      if (error.code >= 400) return 'high';
    }

    // Check error message for keywords
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes('critical') || errorMessage.includes('fatal') || 
        errorMessage.includes('severe') || errorMessage.includes('emergency')) {
      return 'critical';
    }

    if (errorMessage.includes('failed') || errorMessage.includes('error') ||
        errorMessage.includes('unable') || errorMessage.includes('cannot')) {
      return 'high';
    }

    if (errorMessage.includes('warning') || errorMessage.includes('notice')) {
      return 'low';
    }

    // Default based on operation type
    if (operation.includes('bulk_') || operation.includes('claim') || operation.includes('reverse')) {
      return 'critical';
    }

    if (operation.includes('download') || operation.includes('upload') || operation.includes('fetch')) {
      return 'high';
    }

    return defaultSeverity || 'medium';
  }

  /**
   * Create notification title and message
   */
  createNotificationContent(operation, error, orderId, vendorName) {
    const operationNames = {
      'claim_order': 'Order Claim',
      'bulk_claim_orders': 'Bulk Order Claim',
      'reverse_order': 'Order Reverse',
      'bulk_reverse_orders': 'Bulk Order Reverse',
      'mark_ready': 'Mark Order Ready',
      'bulk_mark_ready': 'Bulk Mark Orders Ready',
      'download_label': 'Label Download',
      'bulk_download_labels': 'Bulk Label Download',
      'login': 'Login',
      'token_refresh': 'Token Refresh',
      'fetch_orders': 'Orders Fetch',
      'refresh_orders': 'Orders Refresh',
      'fetch_grouped_orders': 'Grouped Orders Fetch',
      'fetch_payments': 'Payments Fetch',
      'fetch_settlements': 'Settlements Fetch',
      'fetch_transactions': 'Transactions Fetch',
      'create_settlement_request': 'Settlement Request',
      'upload_payment_proof': 'Payment Proof Upload',
      'fetch_address': 'Address Fetch',
      'update_address': 'Address Update',
      'upload_file': 'File Upload',
      'download_file': 'File Download'
    };

    const operationName = operationNames[operation] || operation;
    const orderInfo = orderId ? ` - Order ${orderId}` : '';
    
    const title = `${operationName} Failed${orderInfo}`;
    
    let message = `Vendor "${vendorName}" encountered an error during ${operationName.toLowerCase()}`;
    
    if (orderId) {
      message += ` for order ${orderId}`;
    }
    
    message += `. Error: ${error.message}`;

    return { title, message };
  }

  /**
   * Format error details for storage
   */
  formatErrorDetails(error, context) {
    const details = {
      error_type: error.type || 'unknown',
      error_code: error.code || null,
      error_message: error.message,
      timestamp: new Date().toISOString(),
      context: {
        user_agent: context.userAgent || null,
        url: context.url || null,
        method: context.method || null,
        status_code: context.statusCode || null
      }
    };

    if (error.stack) {
      details.stack_trace = error.stack;
    }

    return JSON.stringify(details, null, 2);
  }

  /**
   * Track API errors from vendor requests
   */
  async trackApiError(req, error, operation) {
    try {
      const vendorId = req.user?.id;
      const vendorName = req.user?.name;
      const userAgent = req.get('User-Agent');
      
      const errorData = {
        vendorId,
        vendorName,
        operation,
        error: {
          type: 'API_ERROR',
          code: error.code || error.status || null,
          message: error.message,
          stack: error.stack
        },
        context: {
          userAgent,
          url: req.url,
          method: req.method,
          statusCode: error.status || 500,
          warehouseId: req.user?.warehouseId
        }
      };

      return await this.trackVendorError(errorData);
    } catch (trackingError) {
      console.error('❌ Error tracking API error:', trackingError);
      // Don't throw - error tracking should not break the main flow
    }
  }

  /**
   * Track frontend errors from vendor panel
   */
  async trackFrontendError(vendorId, vendorName, operation, error, context = {}) {
    try {
      const errorData = {
        vendorId,
        vendorName,
        operation,
        error: {
          type: 'FRONTEND_ERROR',
          code: error.code || null,
          message: error.message,
          stack: error.stack
        },
        orderId: context.orderId,
        orderIds: context.orderIds,
        metadata: {
          component: context.component,
          action: context.action,
          timestamp: new Date().toISOString()
        },
        context: {
          userAgent: context.userAgent,
          url: context.url
        }
      };

      return await this.trackVendorError(errorData);
    } catch (trackingError) {
      console.error('❌ Error tracking frontend error:', trackingError);
      // Don't throw - error tracking should not break the main flow
    }
  }

  /**
   * Track network errors
   */
  async trackNetworkError(vendorId, vendorName, operation, error, context = {}) {
    try {
      const errorData = {
        vendorId,
        vendorName,
        operation,
        error: {
          type: 'NETWORK_ERROR',
          code: error.code || 'NETWORK_ERROR',
          message: error.message || 'Network request failed',
          stack: error.stack
        },
        orderId: context.orderId,
        orderIds: context.orderIds,
        severity: 'high',
        metadata: {
          endpoint: context.endpoint,
          method: context.method,
          statusCode: context.statusCode,
          retryCount: context.retryCount || 0
        },
        context: {
          userAgent: context.userAgent,
          url: context.url
        }
      };

      return await this.trackVendorError(errorData);
    } catch (trackingError) {
      console.error('❌ Error tracking network error:', trackingError);
    }
  }

  /**
   * Get error statistics for vendor
   */
  async getVendorErrorStats(vendorId, days = 7) {
    try {
      const query = `
        SELECT 
          type,
          severity,
          COUNT(*) as count,
          MAX(created_at) as last_error
        FROM notifications 
        WHERE vendor_id = ? 
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY type, severity
        ORDER BY count DESC
      `;

      const stats = await database.query(query, [vendorId, days]);
      
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('❌ Error getting vendor error stats:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new VendorErrorTrackingService();
