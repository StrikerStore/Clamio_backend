const shipwayCarrierService = require('./shipwayCarrierService');

class CarrierSyncService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the carrier sync process
   * This can be called independently or scheduled
   */
  async startCarrierSync() {
    if (this.isRunning) {
      console.log('🔄 Carrier sync already running, skipping...');
      return { success: false, message: 'Carrier sync already in progress' };
    }

    this.isRunning = true;
    
    try {
      console.log('🚀 CARRIER SYNC: Starting independent carrier sync...');
      
      const result = await shipwayCarrierService.syncCarriersToMySQL();
      
      console.log('✅ CARRIER SYNC: Completed successfully');
      console.log('  - Carriers synced:', result.carrierCount);
      console.log('  - Database:', result.database || 'MySQL');
      
      return {
        success: true,
        message: result.message,
        carrierCount: result.carrierCount,
        database: result.database || 'MySQL',
        filePath: result.filePath, // Keep for backward compatibility
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('💥 CARRIER SYNC: Failed:', error.message);
      return {
        success: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new CarrierSyncService(); 