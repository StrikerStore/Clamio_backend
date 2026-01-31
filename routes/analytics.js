const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateToken, requireVendor, requireAdminOrSuperadmin } = require('../middleware/auth');

// Apply authentication to all analytics routes
router.use(authenticateToken);

/**
 * @route   GET /api/analytics/vendor/:vendorId?
 * @desc    Get fulfillment analytics for a specific vendor (or self if vendor requester)
 * @access  Vendor (self) or Admin/Superadmin
 */
router.get('/vendor/:vendorId?', (req, res, next) => {
    // If user is a vendor, they can only access their own stats (vendorId from token)
    // If user is admin/superadmin, they can access any vendorId or all
    if (req.user.role === 'vendor') {
        return analyticsController.getVendorAnalytics(req, res);
    }

    // For admins, vendorId is required or they can use the admin overview
    if (!req.params.vendorId && req.user.role !== 'vendor') {
        return analyticsController.getAdminAnalytics(req, res);
    }

    analyticsController.getVendorAnalytics(req, res);
});

/**
 * @route   GET /api/analytics/admin/overview
 * @desc    Get aggregated fulfillment analytics for all vendors
 * @access  Admin/Superadmin
 */
router.get('/admin/overview', requireAdminOrSuperadmin, analyticsController.getAdminAnalytics);

module.exports = router;
