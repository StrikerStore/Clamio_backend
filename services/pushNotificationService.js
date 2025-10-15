/**
 * Push Notification Service
 * Handles Web Push notifications for admin panel
 */

const webpush = require('web-push');
const database = require('../config/database');

class PushNotificationService {
  constructor() {
    // Initialize VAPID keys (optional - can be skipped)
    this.vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      privateKey: process.env.VAPID_PRIVATE_KEY || null
    };

    // Only configure webpush if VAPID keys are provided
    if (this.vapidKeys.publicKey && this.vapidKeys.privateKey) {
      webpush.setVapidDetails(
        'mailto:admin@clamio.com',
        this.vapidKeys.publicKey,
        this.vapidKeys.privateKey
      );
      console.log('🔔 Push Notification Service initialized with VAPID keys');
    } else {
      console.log('🔔 Push Notification Service initialized (VAPID keys not configured)');
    }
  }

  /**
   * Get VAPID public key for frontend
   */
  getVapidPublicKey() {
    return this.vapidKeys.publicKey;
  }

  /**
   * Check if VAPID keys are configured
   */
  isVapidConfigured() {
    return !!(this.vapidKeys.publicKey && this.vapidKeys.privateKey);
  }

  /**
   * Subscribe admin to push notifications
   */
  async subscribeAdmin(adminId, subscription) {
    try {
      console.log('📱 Subscribing admin to push notifications:', adminId);

      const query = `
        INSERT INTO push_subscriptions 
        (admin_id, endpoint, p256dh_key, auth_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
        endpoint = VALUES(endpoint),
        p256dh_key = VALUES(p256dh_key),
        auth_key = VALUES(auth_key),
        updated_at = NOW()
      `;

      await database.query(query, [
        adminId,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth
      ]);

      console.log('✅ Admin subscribed successfully:', adminId);
      return { success: true, message: 'Subscribed to push notifications' };
    } catch (error) {
      console.error('❌ Error subscribing admin:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe admin from push notifications
   */
  async unsubscribeAdmin(adminId) {
    try {
      console.log('📱 Unsubscribing admin from push notifications:', adminId);

      await database.query(
        'DELETE FROM push_subscriptions WHERE admin_id = ?',
        [adminId]
      );

      console.log('✅ Admin unsubscribed successfully:', adminId);
      return { success: true, message: 'Unsubscribed from push notifications' };
    } catch (error) {
      console.error('❌ Error unsubscribing admin:', error);
      throw error;
    }
  }

  /**
   * Get admin's push subscription status
   */
  async getAdminSubscriptionStatus(adminId) {
    try {
      if (!adminId) {
        return {
          isSubscribed: false,
          isEnabled: false,
          permission: 'denied',
          subscription: null
        };
      }

      const [subscription] = await database.query(
        'SELECT * FROM push_subscriptions WHERE admin_id = ?',
        [adminId]
      );

      return {
        isSubscribed: !!subscription,
        isEnabled: !!subscription,
        permission: subscription ? 'granted' : 'denied',
        subscription: subscription || null
      };
    } catch (error) {
      console.error('❌ Error getting subscription status:', error);
      return {
        isSubscribed: false,
        isEnabled: false,
        permission: 'denied',
        subscription: null,
        error: error.message
      };
    }
  }

  /**
   * Send push notification to specific admin
   */
  async sendNotificationToAdmin(adminId, notification) {
    try {
      // Check if admin has push notifications enabled
      const [admin] = await database.query(
        'SELECT push_notifications_enabled FROM users WHERE id = ?',
        [adminId]
      );

      if (!admin || !admin.push_notifications_enabled) {
        console.log('📱 Admin has push notifications disabled:', adminId);
        return { success: false, message: 'Push notifications disabled for this admin' };
      }

      // Get admin's push subscription
      const [subscription] = await database.query(
        'SELECT * FROM push_subscriptions WHERE admin_id = ?',
        [adminId]
      );

      if (!subscription) {
        console.log('📱 No push subscription found for admin:', adminId);
        return { success: false, message: 'No push subscription found' };
      }

      // Prepare push notification payload
      const payload = JSON.stringify({
        title: notification.title,
        body: notification.message,
        icon: '/icon-192x192.png',
        badge: '/icon-72x72.png',
        data: {
          notificationId: notification.id,
          type: notification.type,
          severity: notification.severity,
          orderId: notification.order_id,
          vendorName: notification.vendor_name,
          url: `/admin/orders${notification.order_id ? `?order=${notification.order_id}` : ''}`
        },
        actions: [
          {
            action: 'view',
            title: 'View Details',
            icon: '/icon-72x72.png'
          },
          {
            action: 'dismiss',
            title: 'Dismiss',
            icon: '/icon-72x72.png'
          }
        ],
        requireInteraction: notification.severity === 'critical',
        vibrate: notification.severity === 'critical' ? [200, 100, 200] : [200]
      });

      // Send push notification
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh_key,
          auth: subscription.auth_key
        }
      };

      await webpush.sendNotification(pushSubscription, payload);
      
      console.log('✅ Push notification sent to admin:', adminId);
      return { success: true, message: 'Push notification sent successfully' };
    } catch (error) {
      console.error('❌ Error sending push notification:', error);
      
      // If subscription is invalid, remove it
      if (error.statusCode === 410 || error.statusCode === 404) {
        console.log('🗑️ Removing invalid subscription for admin:', adminId);
        await this.unsubscribeAdmin(adminId);
      }
      
      throw error;
    }
  }

  /**
   * Send push notification to all subscribed admins
   */
  async sendNotificationToAllAdmins(notification) {
    try {
      console.log('📢 Sending push notification to all subscribed admins');

      // Check if VAPID is configured
      if (!this.isVapidConfigured()) {
        console.log('📱 VAPID keys not configured, skipping push notifications');
        return { success: true, message: 'VAPID keys not configured, notifications stored in database only', sentCount: 0 };
      }

      // Get all admins with push notifications enabled and active subscriptions
      const admins = await database.query(`
        SELECT u.id, u.name, u.email, ps.endpoint, ps.p256dh_key, ps.auth_key
        FROM users u
        INNER JOIN push_subscriptions ps ON u.id = ps.admin_id
        WHERE u.role IN ('admin', 'superadmin') 
        AND u.status = 'active'
        AND u.push_notifications_enabled = 1
      `);

      if (admins.length === 0) {
        console.log('📱 No subscribed admins found');
        return { success: true, message: 'No subscribed admins found', sentCount: 0 };
      }

      const results = [];
      for (const admin of admins) {
        try {
          const result = await this.sendNotificationToAdmin(admin.id, notification);
          results.push({ adminId: admin.id, ...result });
        } catch (error) {
          console.error(`❌ Failed to send notification to admin ${admin.id}:`, error.message);
          results.push({ adminId: admin.id, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Push notifications sent: ${successCount}/${admins.length}`);

      return {
        success: true,
        message: `Push notifications sent to ${successCount}/${admins.length} admins`,
        sentCount: successCount,
        totalCount: admins.length,
        results
      };
    } catch (error) {
      console.error('❌ Error sending push notifications to all admins:', error);
      throw error;
    }
  }

  /**
   * Update admin's push notification preference
   */
  async updateAdminPushPreference(adminId, enabled) {
    try {
      await database.query(
        'UPDATE users SET push_notifications_enabled = ? WHERE id = ?',
        [enabled ? 1 : 0, adminId]
      );

      console.log(`✅ Updated push notification preference for admin ${adminId}: ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true, message: `Push notifications ${enabled ? 'enabled' : 'disabled'}` };
    } catch (error) {
      console.error('❌ Error updating push notification preference:', error);
      throw error;
    }
  }

  /**
   * Get push notification statistics
   */
  async getPushNotificationStats() {
    try {
      const [stats] = await database.query(`
        SELECT 
          COUNT(DISTINCT u.id) as total_admins,
          COUNT(DISTINCT CASE WHEN u.push_notifications_enabled = 1 THEN u.id END) as enabled_admins,
          COUNT(DISTINCT ps.admin_id) as subscribed_admins,
          COUNT(DISTINCT CASE WHEN u.push_notifications_enabled = 1 AND ps.admin_id IS NOT NULL THEN u.id END) as active_admins
        FROM users u
        LEFT JOIN push_subscriptions ps ON u.id = ps.admin_id
        WHERE u.role IN ('admin', 'superadmin') AND u.status = 'active'
      `);

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('❌ Error getting push notification stats:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new PushNotificationService();
