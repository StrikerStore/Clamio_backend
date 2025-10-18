/**
 * Notification Controller
 * Handles all notification-related operations for admin panel
 */

const database = require('../config/database');
const pushNotificationService = require('../services/pushNotificationService');

/**
 * @desc    Get all notifications with pagination and filters
 * @route   GET /api/notifications
 * @access  Admin/Superadmin
 */
exports.getNotifications = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      severity,
      vendor_id,
      order_id,
      start_date,
      end_date,
      search
    } = req.query;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    // Build WHERE conditions
    if (status) {
      conditions.push('n.status = ?');
      params.push(status);
    }

    if (type) {
      conditions.push('n.type = ?');
      params.push(type);
    }

    if (severity) {
      conditions.push('n.severity = ?');
      params.push(severity);
    }

    if (vendor_id) {
      conditions.push('n.vendor_id = ?');
      params.push(vendor_id);
    }

    if (order_id) {
      conditions.push('n.order_id LIKE ?');
      params.push(`%${order_id}%`);
    }

    if (start_date) {
      conditions.push('n.created_at >= ?');
      params.push(start_date);
    }

    if (end_date) {
      conditions.push('n.created_at <= ?');
      params.push(end_date);
    }

    if (search) {
      conditions.push('(n.title LIKE ? OR n.message LIKE ? OR n.vendor_name LIKE ? OR n.order_id LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate and sanitize limit and offset (convert to integers to prevent SQL injection)
    const safeLimit = Math.max(1, Math.min(10000, parseInt(limit) || 20)); // Between 1 and 10000
    const safeOffset = Math.max(0, parseInt(offset) || 0); // At least 0

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM notifications n ${whereClause}`;
    const countResult = await database.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    // Get notifications with resolved_by user info
    // Note: Using direct integer substitution for LIMIT/OFFSET is safe after parseInt validation
    const query = `
      SELECT 
        n.*,
        resolver.name as resolved_by_admin_name,
        resolver.email as resolved_by_admin_email
      FROM notifications n
      LEFT JOIN users resolver ON n.resolved_by = resolver.id
      ${whereClause}
      ORDER BY 
        CASE n.status
          WHEN 'pending' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'resolved' THEN 3
          WHEN 'dismissed' THEN 4
        END,
        CASE n.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        n.created_at DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `;

    // Use only the WHERE clause params (no LIMIT/OFFSET in params)
    const notifications = await database.query(query, params);

    // Parse JSON metadata
    notifications.forEach(notif => {
      if (notif.metadata && typeof notif.metadata === 'string') {
        try {
          notif.metadata = JSON.parse(notif.metadata);
        } catch (e) {
          notif.metadata = {};
        }
      }
    });

    // Get statistics
    const statsQuery = `
      SELECT 
        status,
        severity,
        COUNT(*) as count
      FROM notifications
      GROUP BY status, severity
    `;
    const stats = await database.query(statsQuery);

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        },
        stats
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
};

/**
 * @desc    Get single notification by ID
 * @route   GET /api/notifications/:id
 * @access  Admin/Superadmin
 */
exports.getNotificationById = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        n.*,
        resolver.name as resolved_by_admin_name,
        resolver.email as resolved_by_admin_email,
        vendor.name as vendor_full_name,
        vendor.email as vendor_email
      FROM notifications n
      LEFT JOIN users resolver ON n.resolved_by = resolver.id
      LEFT JOIN users vendor ON n.vendor_id = vendor.id
      WHERE n.id = ?
    `;

    const [notification] = await database.query(query, [id]);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Parse JSON metadata
    if (notification.metadata && typeof notification.metadata === 'string') {
      try {
        notification.metadata = JSON.parse(notification.metadata);
      } catch (e) {
        notification.metadata = {};
      }
    }

    res.json({
      success: true,
      data: notification
    });
  } catch (error) {
    console.error('Error fetching notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification',
      error: error.message
    });
  }
};

/**
 * @desc    Create new notification
 * @route   POST /api/notifications
 * @access  Admin/Superadmin/Vendor (for creating notifications)
 */
exports.createNotification = async (req, res) => {
  try {
    const {
      type,
      severity = 'medium',
      title,
      message,
      order_id,
      vendor_id,
      vendor_name,
      vendor_warehouse_id,
      metadata,
      error_details
    } = req.body;

    // Debug logging
    console.log('📢 Creating notification...');
    console.log('User authenticated:', !!req.user);
    if (req.user) {
      console.log('User details:', {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role,
        warehouseId: req.user.warehouseId
      });
    }

    // Validate required fields
    if (!type || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Type, title, and message are required'
      });
    }

    // Auto-populate vendor details from authenticated user
    let finalVendorId = vendor_id;
    let finalVendorName = vendor_name;
    let finalVendorWarehouseId = vendor_warehouse_id;

    // If user is authenticated and is a vendor, use their details
    if (req.user && req.user.role === 'vendor') {
      // Override with authenticated user's details for vendors
      finalVendorId = req.user.id;
      finalVendorName = req.user.name;
      finalVendorWarehouseId = req.user.warehouseId || null;
      
      console.log('✅ Auto-populated vendor details:', {
        vendor_id: finalVendorId,
        vendor_name: finalVendorName,
        vendor_warehouse_id: finalVendorWarehouseId
      });
    } else if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
      // For admins/superadmins, use the values from req.body if provided
      console.log('👨‍💼 Admin creating notification, using provided vendor details');
    }

    const query = `
      INSERT INTO notifications 
      (type, severity, title, message, order_id, vendor_id, vendor_name, vendor_warehouse_id, metadata, error_details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      type,
      severity,
      title,
      message,
      order_id || null,
      finalVendorId || null,
      finalVendorName || null,
      finalVendorWarehouseId || null,
      metadata ? JSON.stringify(metadata) : null,
      error_details || null
    ];

    console.log('📝 Inserting notification with params:', params);

    const result = await database.query(query, params);

    console.log('✅ Notification created with ID:', result.insertId);

    const [newNotification] = await database.query(
      'SELECT * FROM notifications WHERE id = ?',
      [result.insertId]
    );

    console.log('📋 Retrieved notification:', newNotification);

    // Send push notification to all subscribed admins
    try {
      const pushResult = await pushNotificationService.sendNotificationToAllAdmins(newNotification);
      console.log('📱 Push notification result:', pushResult);
    } catch (pushError) {
      console.error('❌ Error sending push notification:', pushError);
      // Don't fail the notification creation if push fails
    }

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      data: newNotification
    });
  } catch (error) {
    console.error('❌ Error creating notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notification',
      error: error.message
    });
  }
};

/**
 * @desc    Update notification status
 * @route   PATCH /api/notifications/:id/status
 * @access  Admin/Superadmin
 */
exports.updateNotificationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'in_progress', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const query = 'UPDATE notifications SET status = ? WHERE id = ?';
    await database.query(query, [status, id]);

    const updatedNotification = await database.query(
      'SELECT * FROM notifications WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Notification status updated successfully',
      data: updatedNotification[0]
    });
  } catch (error) {
    console.error('Error updating notification status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification status',
      error: error.message
    });
  }
};

/**
 * @desc    Resolve notification
 * @route   POST /api/notifications/:id/resolve
 * @access  Admin/Superadmin
 */
exports.resolveNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_notes } = req.body;
    const adminId = req.user.id;
    const adminName = req.user.name;

    const query = `
      UPDATE notifications 
      SET 
        status = 'resolved',
        resolved_by = ?,
        resolved_by_name = ?,
        resolved_at = NOW(),
        resolution_notes = ?
      WHERE id = ?
    `;

    await database.query(query, [adminId, adminName, resolution_notes || null, id]);

    const updatedNotification = await database.query(
      `SELECT 
        n.*,
        resolver.name as resolved_by_admin_name,
        resolver.email as resolved_by_admin_email
      FROM notifications n
      LEFT JOIN users resolver ON n.resolved_by = resolver.id
      WHERE n.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Notification resolved successfully',
      data: updatedNotification[0]
    });
  } catch (error) {
    console.error('Error resolving notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve notification',
      error: error.message
    });
  }
};

/**
 * @desc    Dismiss notification
 * @route   POST /api/notifications/:id/dismiss
 * @access  Admin/Superadmin
 */
exports.dismissNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const { dismiss_reason } = req.body;
    const adminId = req.user.id;
    const adminName = req.user.name;

    const query = `
      UPDATE notifications 
      SET 
        status = 'dismissed',
        resolved_by = ?,
        resolved_by_name = ?,
        resolved_at = NOW(),
        resolution_notes = ?
      WHERE id = ?
    `;

    await database.query(query, [
      adminId,
      adminName,
      dismiss_reason ? `Dismissed: ${dismiss_reason}` : 'Dismissed by admin',
      id
    ]);

    res.json({
      success: true,
      message: 'Notification dismissed successfully'
    });
  } catch (error) {
    console.error('Error dismissing notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to dismiss notification',
      error: error.message
    });
  }
};

/**
 * @desc    Delete notification
 * @route   DELETE /api/notifications/:id
 * @access  Superadmin only
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    await database.query('DELETE FROM notifications WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
};

/**
 * @desc    Bulk resolve notifications
 * @route   POST /api/notifications/bulk-resolve
 * @access  Admin/Superadmin
 */
exports.bulkResolveNotifications = async (req, res) => {
  try {
    const { notification_ids, resolution_notes } = req.body;
    const adminId = req.user.id;
    const adminName = req.user.name;

    if (!Array.isArray(notification_ids) || notification_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'notification_ids array is required'
      });
    }

    const placeholders = notification_ids.map(() => '?').join(',');
    const query = `
      UPDATE notifications 
      SET 
        status = 'resolved',
        resolved_by = ?,
        resolved_by_name = ?,
        resolved_at = NOW(),
        resolution_notes = ?
      WHERE id IN (${placeholders})
    `;

    await database.query(query, [adminId, adminName, resolution_notes || 'Bulk resolved', ...notification_ids]);

    res.json({
      success: true,
      message: `${notification_ids.length} notifications resolved successfully`
    });
  } catch (error) {
    console.error('Error bulk resolving notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk resolve notifications',
      error: error.message
    });
  }
};

/**
 * @desc    Get notification statistics
 * @route   GET /api/notifications/stats
 * @access  Admin/Superadmin
 */
exports.getNotificationStats = async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed,
        SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as last_24h,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as last_7days
      FROM notifications
    `;

    const [stats] = await database.query(statsQuery);

    const typeStatsQuery = `
      SELECT 
        type,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count
      FROM notifications
      GROUP BY type
      ORDER BY count DESC
    `;

    const typeStats = await database.query(typeStatsQuery);

    // Get push notification stats
    const pushStats = await pushNotificationService.getPushNotificationStats();

    res.json({
      success: true,
      data: {
        overview: stats,
        by_type: typeStats,
        push_notifications: pushStats.data
      }
    });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification statistics',
      error: error.message
    });
  }
};

/**
 * @desc    Get VAPID public key
 * @route   GET /api/notifications/vapid-key
 * @access  Authenticated users
 */
exports.getVapidKey = async (req, res) => {
  try {
    const publicKey = pushNotificationService.getVapidPublicKey();
    
    if (!publicKey) {
      return res.json({
        success: false,
        message: 'VAPID keys not configured',
        data: { publicKey: null }
      });
    }

    res.json({
      success: true,
      data: { publicKey }
    });
  } catch (error) {
    console.error('Error getting VAPID key:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get VAPID key',
      error: error.message,
      data: { publicKey: null }
    });
  }
};

/**
 * @desc    Subscribe to push notifications
 * @route   POST /api/notifications/subscribe
 * @access  Authenticated users
 */
exports.subscribeToPush = async (req, res) => {
  try {
    console.log('🔔 [NOTIFICATION CONTROLLER] Push subscription request received');
    console.log('🔔 [NOTIFICATION CONTROLLER] User:', {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role
    });

    const { subscription } = req.body;
    const adminId = req.user.id;

    console.log('🔔 [NOTIFICATION CONTROLLER] Request body:', {
      hasSubscription: !!subscription,
      endpoint: subscription?.endpoint,
      hasKeys: !!subscription?.keys,
      keysStructure: subscription?.keys ? Object.keys(subscription.keys) : null
    });

    if (!subscription || !subscription.endpoint) {
      console.log('❌ [NOTIFICATION CONTROLLER] Invalid subscription data');
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription data'
      });
    }

    console.log('🔔 [NOTIFICATION CONTROLLER] Calling push notification service...');
    const result = await pushNotificationService.subscribeAdmin(adminId, subscription);
    console.log('🔔 [NOTIFICATION CONTROLLER] Service result:', result);

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('❌ [NOTIFICATION CONTROLLER] Error subscribing to push notifications:', error);
    console.error('❌ [NOTIFICATION CONTROLLER] Error details:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe to push notifications',
      error: error.message
    });
  }
};

/**
 * @desc    Unsubscribe from push notifications
 * @route   POST /api/notifications/unsubscribe
 * @access  Authenticated users
 */
exports.unsubscribeFromPush = async (req, res) => {
  try {
    const adminId = req.user.id;
    const result = await pushNotificationService.unsubscribeAdmin(adminId);

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Error unsubscribing from push notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unsubscribe from push notifications',
      error: error.message
    });
  }
};

/**
 * @desc    Get push subscription status
 * @route   GET /api/notifications/push-status
 * @access  Authenticated users
 */
exports.getPushStatus = async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
        data: {
          isSubscribed: false,
          isEnabled: false,
          permission: 'denied'
        }
      });
    }

    const adminId = req.user.id;
    const status = await pushNotificationService.getAdminSubscriptionStatus(adminId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting push subscription status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get push subscription status',
      error: error.message,
      data: {
        isSubscribed: false,
        isEnabled: false,
        permission: 'denied'
      }
    });
  }
};

/**
 * @desc    Update push notification preference
 * @route   PATCH /api/notifications/push-preference
 * @access  Authenticated users
 */
exports.updatePushPreference = async (req, res) => {
  try {
    const { enabled } = req.body;
    const adminId = req.user.id;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Invalid preference value'
      });
    }

    const result = await pushNotificationService.updateAdminPushPreference(adminId, enabled);

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Error updating push notification preference:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update push notification preference',
      error: error.message
    });
  }
};

