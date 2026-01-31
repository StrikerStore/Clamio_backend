const database = require('../config/database');

/**
 * Analytics Controller
 * Handles fulfillment analytics for vendors and admins
 */
class AnalyticsController {
    /**
     * Get vendor fulfillment analytics
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async getVendorAnalytics(req, res) {
        try {
            const { vendorId } = req.params;
            const { dateFrom, dateTo, store } = req.query;

            // Extract vendorId from user if it's a vendor requester
            const requester = req.user;
            let targetVendorId = vendorId;

            if (requester.role === 'vendor') {
                targetVendorId = requester.warehouseId;
            }

            if (!targetVendorId) {
                return res.status(400).json({
                    success: false,
                    message: 'Vendor ID is required'
                });
            }

            const options = {
                vendorId: targetVendorId,
                dateFrom,
                dateTo,
                store
            };

            // Fetch all analytics data in parallel
            const [stats, distribution, trend] = await Promise.all([
                database.getVendorFulfillmentStats(options),
                database.getVendorStatusDistribution(options),
                database.getVendorHandoverTrend(options)
            ]);

            res.json({
                success: true,
                data: {
                    stats: {
                        total_claimed: stats.totalClaimed,
                        total_handed_over: stats.totalHandedOver,
                        fulfillment_rate: stats.fulfillmentRate,
                        avg_handover_hours: parseFloat(stats.avgHandoverHours)
                    },
                    distribution: distribution,
                    trend: trend.map(t => ({
                        date: t.date,
                        count: t.handover_count,
                        claimed_count: t.claimed_count
                    }))
                }
            });
        } catch (error) {
            console.error('Error in getVendorAnalytics:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get admin overview analytics (aggregated for all vendors)
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async getAdminAnalytics(req, res) {
        try {
            const { dateFrom, dateTo, store, vendorId } = req.query;

            const options = {
                vendorId: vendorId === 'all' ? null : vendorId,
                dateFrom,
                dateTo,
                store
            };

            // Fetch all analytics data in parallel
            const [stats, distribution, trend] = await Promise.all([
                database.getVendorFulfillmentStats(options),
                database.getVendorStatusDistribution(options),
                database.getVendorHandoverTrend(options)
            ]);

            res.json({
                success: true,
                data: {
                    stats: {
                        total_claimed: stats.totalClaimed,
                        total_handed_over: stats.totalHandedOver,
                        fulfillment_rate: stats.fulfillmentRate,
                        avg_handover_hours: parseFloat(stats.avgHandoverHours)
                    },
                    distribution: distribution,
                    trend: trend.map(t => ({
                        date: t.date,
                        count: t.handover_count,
                        claimed_count: t.claimed_count
                    }))
                }
            });
        } catch (error) {
            console.error('Error in getAdminAnalytics:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

module.exports = new AnalyticsController();
