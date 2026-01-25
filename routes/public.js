/**
 * Public Routes
 * Routes that don't require authentication
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const database = require('../config/database');

/**
 * @route   GET /api/public/vapid-key
 * @desc    Get VAPID public key for push notifications
 * @access  Public (VAPID public keys are meant to be public)
 */
router.get('/vapid-key', notificationController.getVapidKey);

/**
 * @route   GET /api/public/shipment-status-mapping
 * @desc    Get shipment status mapping for frontend badge colors and display names
 * @access  Public (status display is public information)
 */
router.get('/shipment-status-mapping', async (req, res) => {
    try {
        const mapping = await database.getShipmentStatusMapping();
        res.json({
            success: true,
            data: mapping
        });
    } catch (error) {
        console.error('Error fetching shipment status mapping:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch shipment status mapping'
        });
    }
});

module.exports = router;

