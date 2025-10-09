/**
 * Notification Routes
 * Handles all notification-related API endpoints
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, requireAdminOrSuperadmin, requireSuperadmin } = require('../middleware/auth');

// Apply authentication to all notification routes
router.use(authenticateToken);

/**
 * @route   GET /api/notifications/stats
 * @desc    Get notification statistics
 * @access  Admin/Superadmin
 */
router.get('/stats', requireAdminOrSuperadmin, notificationController.getNotificationStats);

/**
 * @route   GET /api/notifications
 * @desc    Get all notifications with pagination and filters
 * @access  Admin/Superadmin
 */
router.get('/', requireAdminOrSuperadmin, notificationController.getNotifications);

/**
 * @route   GET /api/notifications/:id
 * @desc    Get single notification by ID
 * @access  Admin/Superadmin
 */
router.get('/:id', requireAdminOrSuperadmin, notificationController.getNotificationById);

/**
 * @route   POST /api/notifications
 * @desc    Create new notification (can be called by vendors too)
 * @access  Authenticated users
 */
router.post('/', notificationController.createNotification);

/**
 * @route   PATCH /api/notifications/:id/status
 * @desc    Update notification status
 * @access  Admin/Superadmin
 */
router.patch('/:id/status', requireAdminOrSuperadmin, notificationController.updateNotificationStatus);

/**
 * @route   POST /api/notifications/:id/resolve
 * @desc    Resolve notification
 * @access  Admin/Superadmin
 */
router.post('/:id/resolve', requireAdminOrSuperadmin, notificationController.resolveNotification);

/**
 * @route   POST /api/notifications/:id/dismiss
 * @desc    Dismiss notification
 * @access  Admin/Superadmin
 */
router.post('/:id/dismiss', requireAdminOrSuperadmin, notificationController.dismissNotification);

/**
 * @route   POST /api/notifications/bulk-resolve
 * @desc    Bulk resolve notifications
 * @access  Admin/Superadmin
 */
router.post('/bulk-resolve', requireAdminOrSuperadmin, notificationController.bulkResolveNotifications);

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete notification
 * @access  Superadmin only
 */
router.delete('/:id', requireSuperadmin, notificationController.deleteNotification);

module.exports = router;

