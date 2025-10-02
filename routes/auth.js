const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken, rateLimit } = require('../middleware/auth');
const { 
  validateUserLogin, 
  validatePhoneLogin, 
  validatePasswordReset 
} = require('../middleware/validation');

/**
 * Authentication Routes
 * Handles user authentication and profile management with Basic Auth
 */

// Apply rate limiting to all auth routes - increased limit for better UX
router.use(rateLimit(20, 15 * 60 * 1000)); // 20 attempts per 15 minutes

/**
 * @route   POST /api/auth/login
 * @desc    User login with email and password
 * @access  Public
 */
router.post('/login', validateUserLogin, authController.login);

/**
 * @route   POST /api/auth/login/phone
 * @desc    User login with phone and password
 * @access  Public
 */
router.post('/login/phone', validatePhoneLogin, authController.loginWithPhone);

/**
 * @route   POST /api/auth/logout
 * @desc    User logout
 * @access  Public
 */
router.post('/logout', authController.logout);

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', authenticateToken, authController.getProfile);

/**
 * @route   PUT /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.put('/change-password', authenticateToken, validatePasswordReset, authController.changePassword);

/**
 * @route   PUT /api/auth/change-user-password
 * @desc    Change any user's password (Superadmin only)
 * @access  Private (Superadmin)
 */
router.put('/change-user-password', authenticateToken, authController.changeUserPassword);

/**
 * @route   GET /api/auth/verify
 * @desc    Verify Basic Auth credentials
 * @access  Private
 */
router.get('/verify', authenticateToken, authController.verifyAuth);

/**
 * @route   POST /api/auth/generate-header
 * @desc    Generate Basic Auth header for testing
 * @access  Public
 */
router.post('/generate-header', validateUserLogin, authController.generateAuthHeader);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password without authentication (for login page)
 * @access  Public
 */
router.post('/reset-password', validatePasswordReset, authController.resetPassword);

module.exports = router; 