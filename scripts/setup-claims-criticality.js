#!/usr/bin/env node

/**
 * Setup Claims Criticality Script
 * 
 * This script initializes the Claims Criticality feature by:
 * 1. Adding the is_critical column to the claims table if it doesn't exist.
 * 2. Updating all existing claims according to the criticality rule:
 *    - Critical (1): Unclaimed orders older than 15 days.
 *    - Normal (0): All other orders.
 * 
 * Usage: node scripts/setup-claims-criticality.js
 */

require('dotenv').config();
const database = require('../config/database');
const autoReversalService = require('../services/autoReversalService');

async function setupClaimsCriticality() {
    const startTime = new Date();
    console.log(`[${startTime.toISOString()}] 🚀 Starting Claims Criticality setup...`);

    try {
        // 1. Initialize Database
        console.log('📡 Connecting to database...');
        await database.waitForMySQLInitialization();

        if (!database.isMySQLAvailable()) {
            throw new Error('Database connection failed. Please check your .env configuration.');
        }
        console.log('✅ Database connected.');

        // 2. Add is_critical column (Migration)
        console.log('\n🛠️ Ensuring is_critical column exists in claims table...');
        await database.addIsCriticalToClaims();

        // 3. Perform initial criticality update
        console.log('\n🔄 Performing initial update of is_critical flags (15-day rule)...');
        const result = await autoReversalService.updateClaimsCriticality();

        if (result.success) {
            console.log(`✅ Initial update successful! Affected rows: ${result.data.affected_rows}`);
        } else {
            console.log(`⚠️ Update finished with warning: ${result.message}`);
        }

        const endTime = new Date();
        const duration = endTime - startTime;
        console.log(`\n✨ Setup completed successfully in ${duration}ms!`);
        process.exit(0);

    } catch (error) {
        console.error(`\n❌ Setup failed:`, error.message);
        process.exit(1);
    }
}

// Execute setup
setupClaimsCriticality();
