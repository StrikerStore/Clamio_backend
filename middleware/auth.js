const bcrypt = require('bcryptjs');
const database = require('../config/database');

/**
 * Authentication Middleware
 * Handles Basic Authentication and role-based access control
 */

/**
 * Decode Basic Auth credentials
 * @param {string} authHeader - Authorization header value
 * @returns {Object|null} Decoded credentials or null if invalid
 */
const decodeBasicAuth = (authHeader) => {
  try {
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return null;
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    // Split only on the first colon to support colons in passwords
    const sepIndex = credentials.indexOf(':');
    if (sepIndex === -1) return null;
    const email = credentials.slice(0, sepIndex);
    const password = credentials.slice(sepIndex + 1);

    return { email, password };
  } catch (error) {
    console.error('Error decoding Basic Auth:', error);
    return null;
  }
};

/**
 * Encode credentials to Basic Auth format
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {string} Basic Auth header value
 */
const encodeBasicAuth = (email, password) => {
  // Ensure we don't accidentally break if password contains colon; encoding preserves it
  const credentials = `${email}:${password}`;
  const base64Credentials = Buffer.from(credentials, 'utf-8').toString('base64');
  return `Basic ${base64Credentials}`;
};

/**
 * Hash password using bcrypt
 * @param {string} password - Plain text password
 * @returns {string} Hashed password
 */
const hashPassword = async (password) => {
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
  return await bcrypt.hash(password, saltRounds);
};

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {boolean} True if password matches hash
 */
const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

/**
 * Basic Authentication middleware
 * Verifies Basic Auth credentials and adds user to request object
 */
const authenticateBasicAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header is required'
      });
    }

    const credentials = decodeBasicAuth(authHeader);
    if (!credentials) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Basic Auth format'
      });
    }

    const { email, password } = credentials;

    // Find user by email - AWAIT the async call
    const user = await database.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'User account is inactive'
      });
    }

    // Verify password
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Basic Auth error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

/**
 * Role-based authorization middleware
 * @param {string|Array} allowedRoles - Role(s) allowed to access the route
 */
const authorizeRoles = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const userRole = req.user.role;
      const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

      if (!roles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions'
        });
      }

      next();
    } catch (error) {
      console.error('Authorization error:', error);
      return res.status(500).json({
        success: false,
        message: 'Authorization failed'
      });
    }
  };
};

/**
 * Superadmin only middleware
 */
const requireSuperadmin = authorizeRoles('superadmin');

/**
 * Admin only middleware
 */
const requireAdmin = authorizeRoles('admin');

/**
 * Vendor only middleware
 */
const requireVendor = authorizeRoles('vendor');

/**
 * Admin or Superadmin middleware
 */
const requireAdminOrSuperadmin = authorizeRoles(['admin', 'superadmin']);

/**
 * Any authenticated user middleware
 */
const requireAnyUser = authorizeRoles(['admin', 'vendor', 'superadmin']);

/**
 * Optional authentication middleware
 * Adds user to request if Basic Auth is valid, but doesn't require it
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    
    if (authHeader && authHeader.startsWith('Basic ')) {
      const credentials = decodeBasicAuth(authHeader);
      if (credentials) {
        const { email, password } = credentials;
        const user = database.getUserByEmail(email);
        
        if (user && user.status === 'active' && bcrypt.compareSync(password, user.password)) {
          req.user = user;
        }
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

/**
 * Rate limiting helper
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @param {number} maxAttempts - Maximum attempts allowed
 * @param {number} windowMs - Time window in milliseconds
 */
const rateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old attempts
    if (attempts.has(key)) {
      attempts.set(key, attempts.get(key).filter(timestamp => timestamp > windowStart));
    }

    const currentAttempts = attempts.get(key) || [];
    
    if (currentAttempts.length >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }

    currentAttempts.push(now);
    attempts.set(key, currentAttempts);

    next();
  };
};

// Keep JWT functions for backward compatibility (if needed)
const generateToken = (user) => {
  // This function is kept for compatibility but not used with Basic Auth
  console.warn('JWT generateToken called but Basic Auth is being used');
  return null;
};

const verifyToken = (token) => {
  // This function is kept for compatibility but not used with Basic Auth
  console.warn('JWT verifyToken called but Basic Auth is being used');
  return null;
};

// Use Basic Auth as the default authentication method
const authenticateToken = authenticateBasicAuth;

module.exports = {
  // Basic Auth functions
  decodeBasicAuth,
  encodeBasicAuth,
  authenticateBasicAuth,
  
  // Password functions
  hashPassword,
  comparePassword,
  
  // Authorization functions
  authorizeRoles,
  requireSuperadmin,
  requireAdmin,
  requireVendor,
  requireAdminOrSuperadmin,
  requireAnyUser,
  optionalAuth,
  
  // Rate limiting
  rateLimit,
  
  // JWT functions (for backward compatibility)
  generateToken,
  verifyToken,
  authenticateToken
}; 