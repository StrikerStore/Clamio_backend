/**
 * Vendor Error Tracking Middleware
 * Automatically tracks vendor API errors and creates notifications
 */

const vendorErrorTrackingService = require('../services/vendorErrorTrackingService');

/**
 * Middleware to track vendor errors - Enhanced for dynamic error capture
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
        type: getErrorTypeFromStatusCode(res.statusCode),
        code: res.statusCode,
        message: extractErrorMessage(data, res.statusCode),
        stack: null,
        url: req.url,
        method: req.method,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
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
        type: getErrorTypeFromStatusCode(res.statusCode),
        code: res.statusCode,
        message: extractErrorMessage(data, res.statusCode),
        stack: null,
        url: req.url,
        method: req.method,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
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
 * Get error type from HTTP status code
 */
function getErrorTypeFromStatusCode(statusCode) {
  if (statusCode >= 500) return 'SERVER_ERROR';
  if (statusCode === 401 || statusCode === 403) return 'AUTHENTICATION_ERROR';
  if (statusCode === 404) return 'NOT_FOUND_ERROR';
  if (statusCode === 422 || statusCode === 400) return 'VALIDATION_ERROR';
  if (statusCode === 429) return 'RATE_LIMIT_ERROR';
  if (statusCode === 408 || statusCode === 504) return 'TIMEOUT_ERROR';
  if (statusCode >= 400) return 'CLIENT_ERROR';
  return 'UNKNOWN_ERROR';
}

/**
 * Extract meaningful error message from response data
 */
function extractErrorMessage(data, statusCode) {
  try {
    // If data is a string, try to parse it
    if (typeof data === 'string') {
      const parsed = JSON.parse(data);
      return parsed.message || parsed.error || data;
    }
    
    // If data is an object
    if (data && typeof data === 'object') {
      return data.message || data.error || data.description || `HTTP ${statusCode} Error`;
    }
    
    // Default message
    return `HTTP ${statusCode} Error`;
  } catch (e) {
    return typeof data === 'string' ? data : `HTTP ${statusCode} Error`;
  }
}

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
 * Error handler middleware for uncaught errors - Enhanced for comprehensive error tracking
 */
const handleVendorErrors = (error, req, res, next) => {
  // Track error if user is a vendor
  if (req.user && req.user.role === 'vendor') {
    const operation = getOperationFromRoute(req.route?.path || req.path, req.method);
    
    // Enhanced error object with more context
    const enhancedError = {
      type: getErrorTypeFromError(error),
      code: error.code || error.statusCode || 500,
      message: error.message || 'Unknown error occurred',
      stack: error.stack,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      originalError: error.name || 'Error'
    };
    
    // Track error asynchronously
    setImmediate(() => {
      vendorErrorTrackingService.trackApiError(req, enhancedError, operation).catch(err => {
        console.error('Error tracking vendor API error:', err);
      });
    });
  }

  // Continue with normal error handling
  next(error);
};

/**
 * Get error type from error object
 */
function getErrorTypeFromError(error) {
  if (error.name === 'ValidationError') return 'VALIDATION_ERROR';
  if (error.name === 'UnauthorizedError') return 'AUTHENTICATION_ERROR';
  if (error.name === 'ForbiddenError') return 'PERMISSION_ERROR';
  if (error.name === 'NotFoundError') return 'NOT_FOUND_ERROR';
  if (error.name === 'TimeoutError') return 'TIMEOUT_ERROR';
  if (error.name === 'NetworkError') return 'NETWORK_ERROR';
  if (error.name === 'DatabaseError') return 'DATABASE_ERROR';
  if (error.name === 'SyntaxError') return 'SYNTAX_ERROR';
  if (error.name === 'TypeError') return 'TYPE_ERROR';
  if (error.name === 'ReferenceError') return 'REFERENCE_ERROR';
  if (error.code === 'ENOTFOUND') return 'NETWORK_ERROR';
  if (error.code === 'ECONNREFUSED') return 'CONNECTION_ERROR';
  if (error.code === 'ETIMEDOUT') return 'TIMEOUT_ERROR';
  if (error.code === 'ER_ACCESS_DENIED_ERROR') return 'DATABASE_ERROR';
  if (error.code === 'ER_BAD_DB_ERROR') return 'DATABASE_ERROR';
  if (error.code === 'ER_DUP_ENTRY') return 'DATABASE_ERROR';
  if (error.code === 'ER_NO_SUCH_TABLE') return 'DATABASE_ERROR';
  
  // Default to UNKNOWN_ERROR for any other error
  return 'UNKNOWN_ERROR';
}

module.exports = {
  trackVendorErrors,
  handleVendorErrors
};
