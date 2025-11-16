/**
 * Product Monitor Service
 * Monitors the products table for new entries within a specified time window
 */

const database = require('../config/database');

class ProductMonitorService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Check for new products added in the last 24 hours
   * @returns {Promise<Object>} Result with new products count and data
   */
  async checkNewProducts() {
    if (this.isRunning) {
      console.log('[Product Monitor] Check already in progress, skipping...');
      return { skipped: true };
    }

    this.isRunning = true;
    console.log('[Product Monitor] Starting check for new products...');

    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();

      if (!database.isMySQLAvailable()) {
        throw new Error('MySQL connection not available');
      }

      const connection = database.getMySQLConnection();

      // Query for products added in the last 24 hours
      const [newProducts] = await connection.execute(`
        SELECT 
          id,
          name,
          image,
          altText,
          totalImages,
          sku_id,
          created_at,
          updated_at
        FROM products
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY created_at DESC
      `);

      console.log(`[Product Monitor] Found ${newProducts.length} new product(s) in the last 24 hours`);

      // Log details of new products
      if (newProducts.length > 0) {
        console.log('[Product Monitor] New Products:');
        newProducts.forEach((product, index) => {
          console.log(`  ${index + 1}. ${product.name} (ID: ${product.id}, SKU: ${product.sku_id || 'N/A'}, Created: ${product.created_at})`);
        });
      }

      // TODO: Add your custom logic here
      // Examples:
      // - Send notifications about new products
      // - Sync to external system
      // - Update inventory
      // - Generate reports
      // - Trigger webhooks

      this.isRunning = false;
      return {
        success: true,
        count: newProducts.length,
        products: newProducts,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[Product Monitor] Error checking new products:', error.message);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Check for new products added within a custom time window
   * @param {number} hours - Number of hours to look back
   * @returns {Promise<Object>} Result with new products count and data
   */
  async checkNewProductsCustomWindow(hours = 24) {
    if (this.isRunning) {
      console.log('[Product Monitor] Check already in progress, skipping...');
      return { skipped: true };
    }

    this.isRunning = true;
    console.log(`[Product Monitor] Starting check for new products (last ${hours} hours)...`);

    try {
      await database.waitForMySQLInitialization();

      if (!database.isMySQLAvailable()) {
        throw new Error('MySQL connection not available');
      }

      const connection = database.getMySQLConnection();

      const [newProducts] = await connection.execute(
        `
        SELECT 
          id,
          name,
          image,
          altText,
          totalImages,
          sku_id,
          created_at,
          updated_at
        FROM products
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        ORDER BY created_at DESC
        `,
        [hours]
      );

      console.log(`[Product Monitor] Found ${newProducts.length} new product(s) in the last ${hours} hours`);

      if (newProducts.length > 0) {
        console.log('[Product Monitor] New Products:');
        newProducts.forEach((product, index) => {
          console.log(`  ${index + 1}. ${product.name} (ID: ${product.id}, SKU: ${product.sku_id || 'N/A'}, Created: ${product.created_at})`);
        });
      }

      this.isRunning = false;
      return {
        success: true,
        count: newProducts.length,
        products: newProducts,
        timeWindow: `${hours} hours`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[Product Monitor] Error checking new products:', error.message);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Get products updated in the last N hours
   * @param {number} hours - Number of hours to look back
   * @returns {Promise<Object>} Result with updated products count and data
   */
  async checkUpdatedProducts(hours = 24) {
    console.log(`[Product Monitor] Checking for updated products (last ${hours} hours)...`);

    try {
      await database.waitForMySQLInitialization();

      if (!database.isMySQLAvailable()) {
        throw new Error('MySQL connection not available');
      }

      const connection = database.getMySQLConnection();

      const [updatedProducts] = await connection.execute(
        `
        SELECT 
          id,
          name,
          image,
          altText,
          totalImages,
          sku_id,
          created_at,
          updated_at
        FROM products
        WHERE updated_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
          AND updated_at > created_at
        ORDER BY updated_at DESC
        `,
        [hours]
      );

      console.log(`[Product Monitor] Found ${updatedProducts.length} updated product(s) in the last ${hours} hours`);

      return {
        success: true,
        count: updatedProducts.length,
        products: updatedProducts,
        timeWindow: `${hours} hours`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[Product Monitor] Error checking updated products:', error.message);
      throw error;
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      service: 'Product Monitor Service'
    };
  }
}

// Export singleton instance
module.exports = new ProductMonitorService();

