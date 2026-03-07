/**
 * In-memory Task Store for async background operations.
 * 
 * Tasks are kept for 1 hour then auto-cleaned.
 * No DB needed — tasks are short-lived and don't need to survive server restarts.
 * If server restarts mid-task, the frontend gets a 404 on next poll and the vendor retries.
 */

const crypto = require('crypto');

class TaskStore {
    constructor() {
        this.tasks = new Map();

        // Auto-cleanup every 10 minutes: remove tasks older than 1 hour
        setInterval(() => this.cleanup(), 10 * 60 * 1000);
    }

    /**
     * Create a new task and return it.
     * Call this BEFORE starting the background work.
     */
    createTask(type, userId = 'unknown') {
        const id = crypto.randomUUID();
        const task = {
            id,
            type,           // e.g. 'download-label', 'refresh', 'bulk-download', 'manifest'
            userId,         // who started the task (for logging)
            status: 'processing',  // processing | completed | failed
            result: null,
            error: null,
            createdAt: new Date(),
            completedAt: null
        };
        this.tasks.set(id, task);
        console.log(`📋 Task [${id}] created: type=${type}, user=${userId}`);
        return task;
    }

    /**
     * Get a task by ID. Returns null if not found/expired.
     */
    getTask(id) {
        return this.tasks.get(id) || null;
    }

    /**
     * Mark task as completed with a result payload.
     */
    completeTask(id, result) {
        const task = this.tasks.get(id);
        if (task) {
            task.status = 'completed';
            task.result = result;
            task.completedAt = new Date();
            console.log(`✅ Task [${id}] completed`);
        }
    }

    /**
     * Mark task as failed with an error message.
     */
    failTask(id, errorMessage) {
        const task = this.tasks.get(id);
        if (task) {
            task.status = 'failed';
            task.error = errorMessage;
            task.completedAt = new Date();
            console.log(`❌ Task [${id}] failed: ${errorMessage}`);
        }
    }

    /**
     * Explicitly delete a task (called from frontend after consuming result).
     */
    deleteTask(id) {
        this.tasks.delete(id);
    }

    /**
     * Remove all tasks older than 1 hour.
     */
    cleanup() {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        let cleaned = 0;
        for (const [id, task] of this.tasks) {
            if (task.createdAt.getTime() < oneHourAgo) {
                this.tasks.delete(id);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`🧹 TaskStore cleanup: removed ${cleaned} expired task(s)`);
        }
    }

    /**
     * Returns current task count (for health checks / debugging).
     */
    size() {
        return this.tasks.size;
    }
}

// Export singleton
module.exports = new TaskStore();
