const database = require('../config/database');
const { hashPassword, comparePassword, encodeBasicAuth } = require('../middleware/auth');
const userSessionService = require('../services/userSessionService');

/**
 * Authentication Controller
 * Handles user authentication and profile management with Basic Auth
 */
class AuthController {
  /**
   * User login with email and password
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Find user by email
      const user = await database.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Check if user is active
      if (user.status !== 'active') {
        return res.status(401).json({
          success: false,
          message: 'Account is inactive. Please contact administrator.'
        });
      }

      // Verify password
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Update last login
      await database.updateUser(user.id, { lastLogin: new Date() });

      // Generate Basic Auth header for client
      const basicAuthHeader = encodeBasicAuth(email, password);

      // If user has warehouseId (vendor), set active session and get token
      let vendorToken = null;
      if (user.warehouseId) {
        try {
          // Ensure tokens and sessions are initialized for this specific user
          await userSessionService.ensureUserTokenAndSession(user.id);
          // Login vendor and get token
          vendorToken = await userSessionService.loginVendor(user.warehouseId);
        } catch (error) {
          console.error('Error setting vendor session:', error);
        }
      }

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: userWithoutPassword,
          authHeader: basicAuthHeader,
          authType: 'Basic',
          vendorToken: vendorToken // Include vendor token for frontend
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * User login with phone and password
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async loginWithPhone(req, res) {
    try {
      const { phone, password } = req.body;

      // Find user by phone
      const user = await database.getUserByPhone(phone);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid phone number or password'
        });
      }

      // Check if user is active
      if (user.status !== 'active') {
        return res.status(401).json({
          success: false,
          message: 'Account is inactive. Please contact administrator.'
        });
      }

      // Verify password
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid phone number or password'
        });
      }

      // Update last login
      await database.updateUser(user.id, { lastLogin: new Date() });

      // Generate Basic Auth header for client
      const basicAuthHeader = encodeBasicAuth(user.email, password);

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: userWithoutPassword,
          authHeader: basicAuthHeader,
          authType: 'Basic'
        }
      });

    } catch (error) {
      console.error('Phone login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get current user profile
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getProfile(req, res) {
    try {
      const user = req.user;
      
      // Remove password from response
      const { password, ...userWithoutPassword } = user;

      res.json({
        success: true,
        data: userWithoutPassword
      });

    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Change user password
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async changePassword(req, res) {
    try {
      const { oldPassword, newPassword } = req.body;
      const userId = req.user.id;

      // Get user with password
      const user = await database.getUserById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify old password
      const isOldPasswordValid = await comparePassword(oldPassword, user.password);
      if (!isOldPasswordValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const hashedNewPassword = await hashPassword(newPassword);

      // Update password
      const updatedUser = await database.updateUser(userId, {
        password: hashedNewPassword
      });

      // Invalidate vendor session if user is a vendor
      try {
        if (user.warehouseId) {
          await userSessionService.ensureUserTokenAndSession(user.id);
          await userSessionService.logoutVendor(user.warehouseId);
        }
      } catch (e) {
        console.warn('Warning: failed to invalidate vendor session on password change:', e.message);
      }

      if (!updatedUser) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update password'
        });
      }

      // Generate new Basic Auth header with new password
      const newBasicAuthHeader = encodeBasicAuth(user.email, newPassword);

      res.json({
        success: true,
        message: 'Password changed successfully',
        data: {
          authHeader: newBasicAuthHeader,
          authType: 'Basic'
        }
      });

    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Reset password without authentication (for login page)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async resetPassword(req, res) {
    try {
      const { email, oldPassword, newPassword, confirmPassword } = req.body;

      // Validation
      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'New passwords do not match'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters long'
        });
      }

      // Find user by email
      const user = await database.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if user is active
      if (user.status !== 'active') {
        return res.status(401).json({
          success: false,
          message: 'Account is inactive. Please contact administrator.'
        });
      }

      // Verify old password
      const isOldPasswordValid = await comparePassword(oldPassword, user.password);
      if (!isOldPasswordValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const hashedNewPassword = await hashPassword(newPassword);

      // Update password
      const updatedUser = await database.updateUser(user.id, {
        password: hashedNewPassword
      });

      // Invalidate vendor session if user is a vendor
      try {
        if (user.warehouseId) {
          await userSessionService.ensureUserTokenAndSession(user.id);
          await userSessionService.logoutVendor(user.warehouseId);
        }
      } catch (e) {
        console.warn('Warning: failed to invalidate vendor session on password change:', e.message);
      }

      if (!updatedUser) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update password'
        });
      }

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Change password for any user (Superadmin only)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async changeUserPassword(req, res) {
    try {
      const { userId, newPassword } = req.body;
      const currentUser = req.user;

      // Only superadmin can change other users' passwords
      if (currentUser.role !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: 'Only superadmin can change other users\' passwords'
        });
      }

      // Get target user
      const targetUser = await database.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Hash new password
      const hashedNewPassword = await hashPassword(newPassword);

      // Update password
      const updatedUser = await database.updateUser(userId, {
        password: hashedNewPassword
      });

      // Invalidate vendor session if target user is a vendor
      try {
        if (targetUser.warehouseId) {
          await userSessionService.ensureUserTokenAndSession(targetUser.id);
          await userSessionService.logoutVendor(targetUser.warehouseId);
        }
      } catch (e) {
        console.warn('Warning: failed to invalidate vendor session on admin password change:', e.message);
      }

      if (!updatedUser) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update password'
        });
      }

      res.json({
        success: true,
        message: `Password changed successfully for ${targetUser.name}`,
        data: {
          userId: targetUser.id,
          userName: targetUser.name,
          userEmail: targetUser.email
        }
      });

    } catch (error) {
      console.error('Change user password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Logout user (client-side auth header removal)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async logout(req, res) {
    try {
      // In Basic Auth, logout is handled client-side
      // by removing the Authorization header
      // No need to track logout time since user is not authenticated

      res.json({
        success: true,
        message: 'Logout successful. Please remove the Authorization header from your requests.'
      });

    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Verify Basic Auth credentials
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async verifyAuth(req, res) {
    try {
      const user = req.user;
      
      // Remove password from response
      const { password, ...userWithoutPassword } = user;

      res.json({
        success: true,
        message: 'Basic Auth credentials are valid',
        data: userWithoutPassword
      });

    } catch (error) {
      console.error('Auth verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Generate Basic Auth header for testing
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async generateAuthHeader(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      // Verify credentials
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
          message: 'Account is inactive. Please contact administrator.'
        });
      }

      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Update last login
      await database.updateUser(user.id, { lastLogin: new Date() });

      // Generate Basic Auth header
      const basicAuthHeader = encodeBasicAuth(email, password);

      // If user has warehouseId (vendor), set active session and get token
      let vendorToken = null;
      if (user.warehouseId) {
        try {
          // Ensure tokens and sessions are initialized for this specific user
          await userSessionService.ensureUserTokenAndSession(user.id);
          // Login vendor and get token
          vendorToken = await userSessionService.loginVendor(user.warehouseId);
        } catch (error) {
          console.error('Error setting vendor session:', error);
        }
      }

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      res.json({
        success: true,
        message: 'Basic Auth header generated successfully',
        data: {
          user: userWithoutPassword,
          authHeader: basicAuthHeader,
          authType: 'Basic',
          vendorToken: vendorToken, // Include vendor token for frontend
          usage: 'Include this header in your requests: Authorization: ' + basicAuthHeader
        }
      });

    } catch (error) {
      console.error('Generate auth header error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

module.exports = new AuthController(); 