require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const shipwayRoutes = require('./routes/shipway');
const ordersRoutes = require('./routes/orders');
const settlementRoutes = require('./routes/settlements');
const notificationRoutes = require('./routes/notifications');
const inventoryRoutes = require('./routes/inventory');
const publicRoutes = require('./routes/public');

// Import database to initialize it
const database = require('./config/database');
const { fetchAndSaveShopifyProducts } = require('./services/shopifyProductFetcher');
const shipwayService = require('./services/shipwayService');
const cron = require('node-cron');

// Import vendor error tracking middleware
const { trackVendorErrors, handleVendorErrors } = require('./middleware/vendorErrorTracking');

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * Security Middleware
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

/**
 * CORS Configuration
 */
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://frontend-dev-production-5a8c.up.railway.app',
      'https://clamiofrontend-production.up.railway.app',
      'https://clamio-frontend-nu.vercel.app',
      "https://claimio.in",
      "https://www.claimio.in",
      "https://dev.claimio.in",
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];
    
    // Add environment variable origin if provided
    if (process.env.CORS_ORIGIN) {
      allowedOrigins.push(process.env.CORS_ORIGIN);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));

/**
 * Rate Limiting - TEMPORARILY DISABLED
 */
// const limiter = rateLimit({
//   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
//   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
//   message: {
//     success: false,
//     message: 'Too many requests from this IP, please try again later.'
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// Rate limiting temporarily disabled for testing
// app.use((req, res, next) => {
//   // Skip rate limiting for auth routes
//   if (req.path.startsWith('/api/auth')) {
//     return next();
//   }
//   // Apply rate limiting for all other routes
//   return limiter(req, res, next);
// });

/**
 * Body Parsing Middleware
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));



/**
 * Logging Middleware
 */
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

/**
 * Database Connection Health Middleware
 * Automatically reconnects if connection is lost after idle periods
 */
app.use(async (req, res, next) => {
  // Skip database check for health and test endpoints
  if (req.path === '/health' || req.path === '/test' || req.path === '/env-check') {
    return next();
  }

  try {
    // Check if database is available
    if (!database.isMySQLAvailable()) {
      console.log('🔄 Database not available, attempting to initialize...');
      await database.initializeMySQL();
    }

    // Test connection health (detects stale connections)
    const isHealthy = await database.testConnection();
    if (!isHealthy) {
      console.log('🔄 Database connection unhealthy, attempting to reconnect...');
      const reconnected = await database.reconnect();
      
      if (!reconnected) {
        // Reconnection failed, return error
        return res.status(503).json({
          success: false,
          message: 'Database temporarily unavailable',
          error: 'Unable to establish database connection. Please try again in a moment.'
        });
      }
    }

    next();
  } catch (error) {
    console.error('❌ Database connection failed in middleware:', error.message);
    
    // For API routes, return error
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth') || 
        req.path.startsWith('/users') || req.path.startsWith('/orders') || 
        req.path.startsWith('/settlements') || req.path.startsWith('/shipway')) {
      return res.status(503).json({
        success: false,
        message: 'Database temporarily unavailable',
        error: 'Service temporarily unavailable. Please try again in a moment.'
      });
    }
    
    // For other routes, continue
    next();
  }
});

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

/**
 * Simple Test Endpoint (no database required)
 */
app.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Simple test endpoint working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

/**
 * Environment Check Endpoint (for debugging)
 */
app.get('/env-check', (req, res) => {
  res.json({
    success: true,
    message: 'Environment variables check',
    database: {
      host: process.env.DB_HOST ? process.env.DB_HOST : 'Missing',
      user: process.env.DB_USER ? process.env.DB_USER : 'Missing',
      password: process.env.DB_PASSWORD ? process.env.DB_PASSWORD : 'Missing',
      database: process.env.DB_NAME ? process.env.DB_NAME : 'Missing',
      port: process.env.DB_PORT ? process.env.DB_PORT : 'Missing',
      ssl: process.env.DB_SSL ? process.env.DB_SSL : 'Missing'
    },
    cors: {
      origin: process.env.CORS_ORIGIN || 'Not set'
    }
  });
});

/**
 * Database Connection Test Endpoint
 */
app.get('/db-test', async (req, res) => {
  try {
    const database = require('./config/database');
    
    // Test connection health
    const isHealthy = await database.testConnection();
    
    if (isHealthy) {
      // Try a simple query
      const users = await database.getAllUsers();
      res.json({
        success: true,
        message: 'Database connection successful',
        data: {
          connected: true,
          healthy: true,
          userCount: users.length,
          sampleUser: users[0] || null
        }
      });
    } else {
      // Try to reconnect
      console.log('🔄 Attempting to reconnect to database...');
      const reconnected = await database.reconnect();
      
      if (reconnected) {
        const users = await database.getAllUsers();
        res.json({
          success: true,
          message: 'Database reconnected successfully',
          data: {
            connected: true,
            healthy: true,
            reconnected: true,
            userCount: users.length,
            sampleUser: users[0] || null
          }
        });
      } else {
        res.json({
          success: false,
          message: 'Database connection failed and reconnection unsuccessful',
          data: {
            connected: false,
            healthy: false,
            reconnected: false
          }
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Database connection test failed',
      error: error.message,
      data: {
        connected: false,
        healthy: false
      }
    });
  }
});

/**
 * Vendor Error Tracking Middleware
 */
app.use('/api', trackVendorErrors);

/**
 * API Routes
 */
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shipway', shipwayRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/settlements', settlementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/inventory', inventoryRoutes);


/**
 * API Documentation Endpoint
 */
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Clamio API v1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/login': 'User login with email and password',
        'POST /api/auth/login/phone': 'User login with phone and password',
        'POST /api/auth/logout': 'User logout',
        'GET /api/auth/profile': 'Get current user profile',
        'PUT /api/auth/change-password': 'Change user password',
        'GET /api/auth/verify': 'Verify JWT token',
        'POST /api/auth/refresh': 'Refresh JWT token'
      },
      users: {
        'POST /api/users': 'Create new user (admin/vendor)',
        'GET /api/users': 'Get all users with pagination',
        'GET /api/users/:id': 'Get user by ID',
        'PUT /api/users/:id': 'Update user',
        'DELETE /api/users/:id': 'Delete user',
        'GET /api/users/role/:role': 'Get users by role',
        'GET /api/users/status/:status': 'Get users by status',
        'PATCH /api/users/:id/toggle-status': 'Toggle user status'
      },
      shipway: {
        'GET /api/shipway/warehouse/:warehouseId': 'Get warehouse details',
        'GET /api/shipway/validate/:warehouseId': 'Validate warehouse ID',
        'GET /api/shipway/test-connection': 'Test Shipway API connection',
        'POST /api/shipway/validate-warehouse': 'Validate warehouse for user creation',
        'POST /api/shipway/multiple-warehouses': 'Get multiple warehouses',
        'GET /api/shipway/stats': 'Get warehouse API statistics'
      }
    },
    authentication: 'Bearer token required for protected routes',
    documentation: 'https://github.com/your-repo/api-docs'
  });
});

/**
 * 404 Handler
 */
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

/**
 * Global Error Handler
 */
app.use(handleVendorErrors);

app.use((error, req, res, next) => {
  console.error('Global error handler:', error);

  // Handle specific error types
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.errors
    });
  }

  if (error.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized access'
    });
  }

  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Default error response
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

/**
 * Graceful Shutdown
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

/**
 * Unhandled Promise Rejection Handler
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

/**
 * Uncaught Exception Handler
 */
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

/**
 * Start Server
 */
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📚 API docs: http://localhost:${PORT}/api`);
  
  // Log database initialization
  console.log('📁 Database initialized successfully');

  // Start periodic database health check (every 15 minutes)
  setInterval(async () => {
    try {
      const isHealthy = await database.testConnection();
      if (!isHealthy) {
        console.log('⚠️ Database connection unhealthy, attempting to reconnect...');
        const reconnected = await database.reconnect();
        if (reconnected) {
          console.log('✅ Database reconnected successfully via health check');
        } else {
          console.error('❌ Database reconnection failed via health check');
        }
      } else {
        console.log('✅ Database health check passed');
      }
    } catch (error) {
      console.error('❌ Database health check failed:', error.message);
    }
  }, 15 * 60 * 1000); // Every 15 minutes
  
  // Initialize user sessions (run once on startup)
  const userSessionService = require('./services/userSessionService');
  try {
    await userSessionService.ensureTokensAndSessions();
    console.log('✅ User sessions initialized');
  } catch (error) {
    console.error('❌ User session initialization failed:', error.message);
  }
  
  // Log default superadmin credentials
  console.log('👤 Default superadmin: superadmin@example.com / password123');
  console.log(process.env.SHOPIFY_ACCESS_TOKEN);
  console.log(process.env.SHOPIFY_PRODUCTS_API_URL);

  // Fetch Shopify products on startup
  fetchAndSaveShopifyProducts(
    process.env.SHOPIFY_PRODUCTS_API_URL || 'https://seq5t1-mz.myshopify.com/admin/api/2025-07/graphql.json',
    {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    }
  );

  // Start Shipway order sync cron job (every hour)
  cron.schedule('0 * * * *', async () => {
    try {
      await shipwayService.syncOrdersToMySQL();
      console.log('[Shipway Sync] Orders synced to MySQL.');
    } catch (err) {
      console.error('[Shipway Sync] Failed:', err.message);
    }
  });
  // Run once immediately on startup
  (async () => {
    try {
      await shipwayService.syncOrdersToMySQL();
      console.log('[Shipway Sync] Orders synced to MySQL (startup).');
    } catch (err) {
      console.error('[Shipway Sync] Startup sync failed:', err.message);
    }
  })();

  // Start Carrier sync cron job (every 6 hours)
  const carrierSyncService = require('./services/carrierSyncService');
  cron.schedule('0 */6 * * *', async () => {
    try {
      await carrierSyncService.startCarrierSync();
      console.log('[Carrier Sync] Carriers synced to MySQL.');
    } catch (err) {
      console.error('[Carrier Sync] Failed:', err.message);
    }
  });
  // Run once immediately on startup
  (async () => {
    try {
      await carrierSyncService.startCarrierSync();
      console.log('[Carrier Sync] Carriers synced to MySQL (startup).');
    } catch (err) {
      console.error('[Carrier Sync] Startup sync failed:', err.message);
    }
  })();

  // Start Order Tracking cron jobs
  const orderTrackingService = require('./services/orderTrackingService');
  
  // Active Orders Tracking - every 1 hour
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('[Order Tracking] Starting active orders sync...');
      await orderTrackingService.syncActiveOrderTracking();
      console.log('[Order Tracking] Active orders sync completed.');
    } catch (err) {
      console.error('[Order Tracking] Active orders sync failed:', err.message);
    }
  });

  // Inactive Orders Tracking - daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('[Order Tracking] Starting inactive orders sync...');
      await orderTrackingService.syncInactiveOrderTracking();
      console.log('[Order Tracking] Inactive orders sync completed.');
    } catch (err) {
      console.error('[Order Tracking] Inactive orders sync failed:', err.message);
    }
  });

  // Order Tracking Cleanup - weekly on Sunday at 3 AM
  cron.schedule('0 3 * * 0', async () => {
    try {
      console.log('[Order Tracking] Starting cleanup of old tracking data...');
      await orderTrackingService.cleanupOldTrackingData();
      console.log('[Order Tracking] Cleanup completed.');
    } catch (err) {
      console.error('[Order Tracking] Cleanup failed:', err.message);
    }
  });

  // Product Refresh - daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('[Product Sync] Starting daily product refresh from Shopify...');
      await fetchAndSaveShopifyProducts(
        process.env.SHOPIFY_PRODUCTS_API_URL || 'https://seq5t1-mz.myshopify.com/admin/api/2025-07/graphql.json',
        {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        true // forceNew = true to ensure fresh data
      );
      console.log('[Product Sync] Daily product refresh completed.');
    } catch (err) {
      console.error('[Product Sync] Daily product refresh failed:', err.message);
    }
  });

  // Product Monitor - Check for new products every 24 hours (daily at 3 AM)
  const productMonitorService = require('./services/productMonitorService');
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('[Product Monitor] Starting daily check for new products...');
      const result = await productMonitorService.checkNewProducts();
      if (result.success) {
        console.log(`[Product Monitor] Check completed. Found ${result.count} new product(s).`);
      }
    } catch (err) {
      console.error('[Product Monitor] Daily check failed:', err.message);
    }
  });

  // Run active orders tracking once immediately on startup (optional)
  (async () => {
    try {
      console.log('[Order Tracking] Running initial active orders sync on startup...');
      await orderTrackingService.syncActiveOrderTracking();
      console.log('[Order Tracking] Initial active orders sync completed.');
    } catch (err) {
      console.error('[Order Tracking] Initial active orders sync failed:', err.message);
    }
  })();
});

module.exports = app; 
