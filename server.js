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

// Import database to initialize it
const database = require('./config/database');
const { fetchAndSaveShopifyProducts } = require('./services/shopifyProductFetcher');
const shipwayService = require('./services/shipwayService');
const cron = require('node-cron');

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
      'https://clamio-frontend-nu.vercel.app',
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
 * Environment Check Endpoint (for debugging)
 */
app.get('/env-check', (req, res) => {
  res.json({
    success: true,
    message: 'Environment variables check',
    database: {
      host: process.env.DB_HOST ? 'Set' : 'Missing',
      user: process.env.DB_USER ? 'Set' : 'Missing',
      password: process.env.DB_PASSWORD ? 'Set' : 'Missing',
      database: process.env.DB_NAME ? 'Set' : 'Missing',
      port: process.env.DB_PORT ? 'Set' : 'Missing',
      ssl: process.env.DB_SSL ? 'Set' : 'Missing'
    },
    cors: {
      origin: process.env.CORS_ORIGIN || 'Not set'
    }
  });
});

/**
 * API Routes
 */
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shipway', shipwayRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/settlements', settlementRoutes);


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
});

module.exports = app; 