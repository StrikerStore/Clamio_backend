/**
 * Tasks API Route
 * 
 * GET    /api/tasks/:taskId  — Poll for task status (called every 2s by frontend)
 * DELETE /api/tasks/:taskId  — Cleanup after frontend consumes the result
 */

const express = require('express');
const router = express.Router();
const taskStore = require('../services/taskStore');

// GET /api/tasks/:taskId
router.get('/:taskId', (req, res) => {
    const { taskId } = req.params;
    const task = taskStore.getTask(taskId);

    if (!task) {
        return res.status(404).json({
            success: false,
            message: 'Task not found or expired. Please retry the operation.'
        });
    }

    return res.json({
        success: true,
        task: {
            id: task.id,
            type: task.type,
            status: task.status,     // 'processing' | 'completed' | 'failed'
            result: task.result,     // set on completion, null while processing
            error: task.error,       // set on failure, null otherwise
            createdAt: task.createdAt,
            completedAt: task.completedAt
        }
    });
});

// DELETE /api/tasks/:taskId — called by frontend to clean up after consuming result
router.delete('/:taskId', (req, res) => {
    taskStore.deleteTask(req.params.taskId);
    return res.json({ success: true });
});

module.exports = router;
