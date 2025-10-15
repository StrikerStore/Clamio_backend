/**
 * Public Routes
 * Routes that don't require authentication
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

/**
 * @route   GET /api/public/vapid-key
 * @desc    Get VAPID public key for push notifications
 * @access  Public (VAPID public keys are meant to be public)
 */
router.get('/vapid-key', notificationController.getVapidKey);

module.exports = router;
