/**
 * Vendor Error Tracking Middleware
 * Automatically tracks vendor API errors and creates notifications
 */

const vendorErrorTrackingService = require('../services/vendorErrorTrackingService');

/**
 * Middleware to track vendor errors
 */
const trackVendorErrors = (req, res, next) => {
  // Store original send method
  const originalSend = res.send;
  const originalJson = res.json;

  // Override send method to track errors
  res.send = function(data) {
    // Track error if status code indicates error and user is a vendor
    if (res.statusCode >= 400 && req.user && req.user.role === 'vendor') {
      const error = {
        type: 'API_ERROR',
        code: res.statusCode,
        message: data?.message || `HTTP ${res.statusCode} Error`,
        stack: null
      };

      // Determine operation from route
      const operation = getOperationFromRoute(req.route?.path || req.path, req.method);

      // Track error asynchronously (don't block response)
      setImmediate(() => {
        vendorErrorTrackingService.trackApiError(req, error, operation).catch(err => {
          console.error('Error tracking vendor API error:', err);
        });
      });
    }

    // Call original send method
    return originalSend.call(this, data);
  };

  // Override json method to track errors
  res.json = function(data) {
    // Track error if status code indicates error and user is a vendor
    if (res.statusCode >= 400 && req.user && req.user.role === 'vendor') {
      const error = {
        type: 'API_ERROR',
        code: res.statusCode,
        message: data?.message || `HTTP ${res.statusCode} Error`,
        stack: null
      };

      // Determine operation from route
      const operation = getOperationFromRoute(req.route?.path || req.path, req.method);

      // Track error asynchronously (don't block response)
      setImmediate(() => {
        vendorErrorTrackingService.trackApiError(req, error, operation).catch(err => {
          console.error('Error tracking vendor API error:', err);
        });
      });
    }

    // Call original json method
    return originalJson.call(this, data);
  };

  next();
};

/**
 * Determine operation from route path and method
 */
function getOperationFromRoute(path, method) {
  const routeMap = {
    // Orders
    '/orders/claim': 'claim_order',
    '/orders/bulk-claim': 'bulk_claim_orders',
    '/orders/reverse': 'reverse_order',
    '/orders/reverse-grouped': 'bulk_reverse_orders',
    '/orders/download-label': 'download_label',
    '/orders/bulk-download-labels': 'bulk_download_labels',
    '/orders/download-pdf': 'download_file',
    '/orders/refresh': 'refresh_orders',
    
    // User/Auth
    '/auth/login': 'login',
    '/auth/refresh': 'token_refresh',
    '/auth/profile': 'fetch_profile',
    
    // Users/Vendor
    '/users/vendor/address': 'fetch_address',
    
    // Settlements
    '/settlements/vendor/request': 'create_settlement_request',
    '/settlements/vendor/payments': 'fetch_payments',
    '/settlements/vendor/history': 'fetch_settlements',
    '/settlements/vendor/transactions': 'fetch_transactions'
  };

  // Direct match
  if (routeMap[path]) {
    return routeMap[path];
  }

  // Pattern matching for dynamic routes
  if (path.includes('/orders/') && method === 'GET') {
    return 'fetch_orders';
  }

  if (path.includes('/orders/grouped') && method === 'GET') {
    return 'fetch_grouped_orders';
  }

  if (path.includes('/users/vendor/') && method === 'GET') {
    return 'fetch_vendor_data';
  }

  if (path.includes('/users/vendor/') && method === 'PUT') {
    return 'update_vendor_data';
  }

  // Default fallback
  return `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/**
 * Error handler middleware for uncaught errors
 */
const handleVendorErrors = (error, req, res, next) => {
  // Track error if user is a vendor
  if (req.user && req.user.role === 'vendor') {
    const operation = getOperationFromRoute(req.route?.path || req.path, req.method);
    
    // Track error asynchronously
    setImmediate(() => {
      vendorErrorTrackingService.trackApiError(req, error, operation).catch(err => {
        console.error('Error tracking vendor API error:', err);
      });
    });
  }

  // Continue with normal error handling
  next(error);
};

module.exports = {
  trackVendorErrors,
  handleVendorErrors
};
