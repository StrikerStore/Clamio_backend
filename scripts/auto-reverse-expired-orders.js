#!/usr/bin/env node

/**
 * Auto-Reverse Expired Orders Script
 * 
 * This script can be run as a cron job to automatically reverse orders
 * that have been claimed for 24+ hours without label download.
 * 
 * Usage:
 * - Manual execution: node auto-reverse-expired-orders.js
 * - Cron job: Add to crontab to run every hour:
 *   0 * * * * cd /path/to/backend && node scripts/auto-reverse-expired-orders.js
 */

const axios = require('axios');
const path = require('path');

// Configuration
const CONFIG = {
  // API endpoint URL - adjust based on your server setup
  apiUrl: process.env.AUTO_REVERSE_API_URL || 'http://localhost:5000/api/orders/auto-reverse-expired',
  
  // Basic auth credentials - should be set as environment variables
  username: process.env.AUTO_REVERSE_USERNAME || 'admin',
  password: process.env.AUTO_REVERSE_PASSWORD || 'admin123',
  
  // Request timeout in milliseconds
  timeout: 30000
};

/**
 * Main function to execute auto-reversal via API
 */
async function autoReverseExpiredOrders() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] 🔄 Starting auto-reversal process...`);

  try {
    // Make HTTP request to the auto-reverse endpoint
    const response = await axios.post(
      CONFIG.apiUrl,
      {}, // Empty body
      {
        auth: {
          username: CONFIG.username,
          password: CONFIG.password
        },
        timeout: CONFIG.timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Auto-Reverse-Cron-Job/1.0'
        }
      }
    );

    const endTime = new Date();
    const duration = endTime - startTime;

    if (response.data.success) {
      const { total_checked, auto_reversed, details, reversed_at, execution_time_ms } = response.data.data;
      
      console.log(`[${endTime.toISOString()}] ✅ Auto-reversal completed successfully`);
      console.log(`  - Duration: ${duration}ms`);
      console.log(`  - Orders checked: ${total_checked}`);
      console.log(`  - Orders auto-reversed: ${auto_reversed}`);
      
      if (auto_reversed > 0) {
        console.log(`  - Auto-reversed orders:`);
        details.forEach(detail => {
          console.log(`    * ${detail.order_id} (${detail.order_unique_id}) - claimed by ${detail.claimed_by} for ${detail.hours_claimed} hours`);
        });
      } else {
        console.log(`  - No orders required auto-reversal`);
      }
      
      // Exit with success code
      process.exit(0);
      
    } else {
      throw new Error(`API returned success: false - ${response.data.message}`);
    }

  } catch (error) {
    const endTime = new Date();
    const duration = endTime - startTime;
    
    console.error(`[${endTime.toISOString()}] ❌ Auto-reversal failed after ${duration}ms`);
    
    if (error.response) {
      // Server responded with error status
      console.error(`  - HTTP Status: ${error.response.status}`);
      console.error(`  - Response:`, error.response.data);
    } else if (error.request) {
      // Request was made but no response received
      console.error(`  - Network Error: No response received from server`);
      console.error(`  - URL: ${CONFIG.apiUrl}`);
    } else {
      // Something else happened
      console.error(`  - Error: ${error.message}`);
    }
    
    // Exit with error code
    process.exit(1);
  }
}

/**
 * Alternative function to execute auto-reversal directly (without API call)
 * This can be used if you want to run the service directly without making HTTP requests
 */
async function autoReverseExpiredOrdersDirect() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] 🔄 Starting direct auto-reversal process...`);

  try {
    // Import the service directly
    const autoReversalService = require('../services/autoReversalService');
    const database = require('../config/database');
    
    // Wait for database initialization
    await database.waitForMySQLInitialization();
    
    // Execute auto-reversal
    const result = await autoReversalService.executeAutoReversal();
    
    const endTime = new Date();
    const duration = endTime - startTime;

    if (result.success) {
      const { total_checked, auto_reversed, details, execution_time_ms } = result.data;
      
      console.log(`[${endTime.toISOString()}] ✅ Auto-reversal completed successfully`);
      console.log(`  - Duration: ${duration}ms`);
      console.log(`  - Orders checked: ${total_checked}`);
      console.log(`  - Orders auto-reversed: ${auto_reversed}`);
      
      if (auto_reversed > 0) {
        console.log(`  - Auto-reversed orders:`);
        details.forEach(detail => {
          console.log(`    * ${detail.order_id} (${detail.order_unique_id}) - claimed by ${detail.claimed_by} for ${detail.hours_claimed} hours`);
        });
      } else {
        console.log(`  - No orders required auto-reversal`);
      }
      
      // Exit with success code
      process.exit(0);
      
    } else {
      throw new Error(`Auto-reversal failed: ${result.message}`);
    }

  } catch (error) {
    const endTime = new Date();
    const duration = endTime - startTime;
    
    console.error(`[${endTime.toISOString()}] ❌ Auto-reversal failed after ${duration}ms`);
    console.error(`  - Error: ${error.message}`);
    
    // Exit with error code
    process.exit(1);
  }
}

/**
 * Handle script termination gracefully
 */
process.on('SIGINT', () => {
  console.log('\n[INFO] Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[INFO] Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run the auto-reversal process
if (require.main === module) {
  // Check command line arguments to determine execution mode
  const args = process.argv.slice(2);
  const useDirectMode = args.includes('--direct') || args.includes('-d');
  
  if (useDirectMode) {
    console.log('📡 Running in direct mode (no API call)');
    autoReverseExpiredOrdersDirect().catch(error => {
      console.error('[FATAL] Unhandled error in direct auto-reversal script:', error);
      process.exit(1);
    });
  } else {
    console.log('🌐 Running in API mode (HTTP request)');
    autoReverseExpiredOrders().catch(error => {
      console.error('[FATAL] Unhandled error in auto-reversal script:', error);
      process.exit(1);
    });
  }
}

module.exports = { autoReverseExpiredOrders, autoReverseExpiredOrdersDirect };
