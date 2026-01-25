/**
 * Run Deploy Tasks
 * 
 * This script runs deployment tasks that should only execute once after a new deployment.
 * It tracks which tasks have run using a .deploy-state file to prevent duplicate runs.
 * 
 * Usage: Automatically runs via npm postinstall hook
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const STATE_FILE = path.join(__dirname, '../.deploy-state.json');
const CURRENT_DEPLOY_VERSION = '2026-01-25-rto-records-update'; // Change this for each deploy that needs the sync

/**
 * Get the current deploy state
 */
function getDeployState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (error) {
        console.log('⚠️ Could not read deploy state file, will create new one');
    }
    return { lastDeployVersion: null, tasksCompleted: [] };
}

/**
 * Save the deploy state
 */
function saveDeployState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Check if a specific task has already run for this deploy version
 */
function hasTaskRun(state, taskName) {
    return state.lastDeployVersion === CURRENT_DEPLOY_VERSION &&
        state.tasksCompleted.includes(taskName);
}

/**
 * Main function to run deploy tasks
 */
async function runDeployTasks() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 RUNNING POST-DEPLOY TASKS');
    console.log('='.repeat(60));
    console.log(`Deploy Version: ${CURRENT_DEPLOY_VERSION}`);
    console.log('');

    const state = getDeployState();

    // Check if we're on a new deploy version
    if (state.lastDeployVersion !== CURRENT_DEPLOY_VERSION) {
        console.log('📦 New deployment detected! Resetting task state...');
        state.lastDeployVersion = CURRENT_DEPLOY_VERSION;
        state.tasksCompleted = [];
    }

    // ============================================
    // TASK 1: Update RTO old records
    // ============================================
    const TASK_UPDATE_RTO_RECORDS = 'update-rto-records';

    if (hasTaskRun(state, TASK_UPDATE_RTO_RECORDS)) {
        console.log(`✅ [SKIP] Task "${TASK_UPDATE_RTO_RECORDS}" already completed for this deploy`);
    } else {
        console.log(`\n🔄 [RUN] Task: ${TASK_UPDATE_RTO_RECORDS}`);
        console.log('-'.repeat(60));

        try {
            // Run the update script
            execSync('node scripts/update-rto-records.js', {
                cwd: path.join(__dirname, '..'),
                stdio: 'inherit',
                env: process.env
            });

            // Mark task as completed
            state.tasksCompleted.push(TASK_UPDATE_RTO_RECORDS);
            saveDeployState(state);
            console.log(`✅ Task "${TASK_UPDATE_RTO_RECORDS}" completed successfully`);
        } catch (error) {
            console.error(`❌ Task "${TASK_UPDATE_RTO_RECORDS}" failed:`, error.message);
            // Don't mark as completed so it can retry next time
            console.log('⚠️ Task will retry on next deployment');
        }
    }

    // ============================================
    // ADD MORE TASKS HERE AS NEEDED
    // ============================================

    // Final save
    saveDeployState(state);

    console.log('\n' + '='.repeat(60));
    console.log('✅ POST-DEPLOY TASKS COMPLETE');
    console.log('='.repeat(60));
    console.log(`Completed tasks: ${state.tasksCompleted.join(', ') || 'none'}`);
    console.log('');
}

// Run the deploy tasks
runDeployTasks().catch(error => {
    console.error('💥 Deploy tasks failed:', error);
    // Don't exit with error code to not block npm install
    process.exit(0);
});
