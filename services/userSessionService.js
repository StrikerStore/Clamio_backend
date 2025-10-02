const crypto = require('crypto');
const database = require('../config/database');

// Simple UUID generation function
function generateUUID() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older Node.js versions
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

class UserSessionService {
  constructor() {
    // No need for Excel-specific initialization
  }

  async ensureTokensAndSessions() {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.error('MySQL connection not available for user session service');
        return;
      }

      const users = await database.getAllUsers();
      
      for (const user of users) {
        const updates = {};

        // Ensure token exists
        if (!user.token) {
          updates.token = generateUUID();
        }

        // Ensure active_session is set to FALSE
        if (user.active_session !== 'TRUE' && user.active_session !== 'FALSE') {
          updates.active_session = 'FALSE';
        }

        if (Object.keys(updates).length > 0) {
          await database.updateUser(user.id, updates);
        }
      }
    } catch (error) {
      console.error('Error ensuring tokens and sessions:', error);
      throw error;
    }
  }

  async ensureUserTokenAndSession(userId) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.error('MySQL connection not available for user session service');
        return;
      }

      // Get specific user instead of all users
      const user = await database.getUserById(userId);
      if (!user) {
        console.error('User not found for token/session initialization:', userId);
        return;
      }

      const updates = {};

      // Ensure token exists
      if (!user.token) {
        updates.token = generateUUID();
      }

      // Ensure active_session is set to FALSE initially
      if (user.active_session !== 'TRUE' && user.active_session !== 'FALSE') {
        updates.active_session = 'FALSE';
      }

      if (Object.keys(updates).length > 0) {
        await database.updateUser(user.id, updates);
      }
    } catch (error) {
      console.error('Error ensuring user token and session:', error);
      throw error;
    }
  }

  async loginVendor(warehouseId) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.error('MySQL connection not available for user session service');
        return null;
      }

      const user = await database.getUserByWarehouseId(warehouseId);
      if (!user) {
        return null;
      }

      // Set this vendor's session to TRUE
      const updates = { active_session: 'TRUE' };
      
      // Ensure token exists
      if (!user.token) {
        updates.token = generateUUID();
      }

      await database.updateUser(user.id, updates);
      
      return updates.token || user.token;
    } catch (error) {
      console.error('Error in loginVendor:', error);
      return null;
    }
  }

  async getActiveVendor() {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.error('MySQL connection not available for user session service');
        return null;
      }

      const users = await database.getAllUsers();
      const activeUser = users.find(user => user.active_session === 'TRUE');
      return activeUser ? activeUser.warehouseId : null;
    } catch (error) {
      console.error('Error in getActiveVendor:', error);
      return null;
    }
  }

  async getVendorByToken(token) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.error('MySQL connection not available for user session service');
        return null;
      }

      const user = await database.getUserByToken(token);
      if (user && user.active_session === 'TRUE') {
        return user;
      }
      return null;
    } catch (error) {
      console.error('Error in getVendorByToken:', error);
      return null;
    }
  }

  async logoutVendor(warehouseId) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.error('MySQL connection not available for user session service');
        return;
      }

      const user = await database.getUserByWarehouseId(warehouseId);
      if (user) {
        await database.updateUser(user.id, { active_session: 'FALSE' });
      }
    } catch (error) {
      console.error('Error in logoutVendor:', error);
    }
  }

  // Get vendor by email for login
  async getVendorByEmail(email) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.error('MySQL connection not available for user session service');
        return null;
      }

      return await database.getUserByEmail(email);
    } catch (error) {
      console.error('Error in getVendorByEmail:', error);
      return null;
    }
  }

  // Get vendor by phone for login
  async getVendorByPhone(phone) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        console.error('MySQL connection not available for user session service');
        return null;
      }

      return await database.getUserByPhone(phone);
    } catch (error) {
      console.error('Error in getVendorByPhone:', error);
      return null;
    }
  }
}

module.exports = new UserSessionService(); 