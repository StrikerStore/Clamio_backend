const axios = require('axios');
const path = require('path');
const fs = require('fs');
const database = require('../config/database');

class ShipwayCarrierService {
  constructor(accountCode = null) {
    this.apiUrl = 'https://app.shipway.com/api/getcarrier';
    this.accountCode = accountCode;
    this.basicAuthHeader = null;
    this.initialized = false;
  }

  /**
   * Initialize service by fetching store credentials
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      if (this.accountCode) {
        // Multi-store mode: fetch credentials from database
        const store = await database.getStoreByAccountCode(this.accountCode);
        
        if (!store) {
          throw new Error(`Store not found for account code: ${this.accountCode}`);
        }
        
        if (store.status !== 'active') {
          throw new Error(`Store is not active: ${this.accountCode}`);
        }
        
        this.basicAuthHeader = store.auth_token;
        console.log(`✅ ShipwayCarrierService initialized for store: ${this.accountCode}`);
      } else {
        // Legacy mode: use environment variable
        this.basicAuthHeader = process.env.SHIPWAY_BASIC_AUTH_HEADER;
        console.log(`✅ ShipwayCarrierService initialized in legacy mode`);
      }

      if (!this.basicAuthHeader) {
        throw new Error('Shipway API configuration error. No auth token available.');
      }

      this.initialized = true;
    } catch (error) {
      console.error('❌ ShipwayCarrierService initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Fetch carriers from Shipway API
   * @returns {Promise<Array>} Array of carrier data
   */
  async fetchCarriersFromShipway() {
    // Initialize service if not already initialized
    await this.initialize();
    
    try {
      console.log(`🔵 SHIPWAY CARRIER: Fetching carriers from Shipway API${this.accountCode ? ` (${this.accountCode})` : ''}...`);
      
      if (!this.basicAuthHeader) {
        throw new Error('Shipway API configuration error. SHIPWAY_BASIC_AUTH_HEADER not found in environment variables.');
      }
      
      const response = await axios.get(this.apiUrl, {
        timeout: 30000, // 30 seconds timeout
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json',
          'User-Agent': 'Clamio-Carrier-Service/1.0'
        }
      });

      console.log('✅ SHIPWAY CARRIER: API response received');
      console.log('  - Status:', response.status);
      console.log('  - Data length:', response.data ? Object.keys(response.data).length : 'No data');

      return response.data;
    } catch (error) {
      console.error('💥 SHIPWAY CARRIER: Error fetching carriers:', error.message);
      
      if (error.response) {
        console.error('  - Response status:', error.response.status);
        console.error('  - Response data:', error.response.data);
        
        // Handle specific error cases
        if (error.response.status === 401) {
          throw new Error('Authentication failed. Please check your SHIPWAY_BASIC_AUTH_HEADER configuration.');
        } else if (error.response.status === 403) {
          throw new Error('Access forbidden. Please check your API permissions.');
        } else if (error.response.status === 404) {
          throw new Error('Carrier API endpoint not found. Please verify the API URL.');
        }
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Shipway API. Please check your internet connection.');
      } else if (error.code === 'ETIMEDOUT') {
        throw new Error('Request to Shipway API timed out. Please try again.');
      }
      
      throw new Error(`Failed to fetch carriers from Shipway: ${error.message}`);
    }
  }

  /**
   * Extract carrier data from Shipway response
   * @param {Object} shipwayData - Raw data from Shipway API
   * @returns {Array} Processed carrier data
   */
  extractCarrierData(shipwayData) {
    try {
      console.log('🔵 SHIPWAY CARRIER: Extracting carrier data...');
      
      const carriers = [];
      
      // Handle different possible response structures
      let carrierArray = [];
      
      if (Array.isArray(shipwayData)) {
        carrierArray = shipwayData;
      } else if (shipwayData && typeof shipwayData === 'object') {
        // If it's an object, try to find the carriers array
        if (shipwayData.carriers) {
          carrierArray = shipwayData.carriers;
        } else if (shipwayData.data) {
          carrierArray = shipwayData.data;
        } else if (shipwayData.result) {
          carrierArray = shipwayData.result;
        } else if (shipwayData.message && Array.isArray(shipwayData.message)) {
          // Based on the API response structure shown in the image
          carrierArray = shipwayData.message;
        } else {
          // If it's a flat object, try to extract carrier info
          carrierArray = [shipwayData];
        }
      }

      console.log('  - Found carriers:', carrierArray.length);

      carrierArray.forEach((carrier, index) => {
        try {
          // Extract carrier_id, carrier name, and status based on the mapping
          const carrierId = carrier.id || carrier.carrier_id || carrier.carrierId || `CARRIER_${index + 1}`;
          const carrierName = carrier.name || carrier.carrier_name || carrier.carrierName || 'Unknown Carrier';
          const status = 'Active'; // Default value as requested

          // Extract weight from carrier name (format: "Name (Xkg)")
          let weightInKg = '';
          const weightMatch = carrierName.match(/\((\d+(?:\.\d+)?)\s*kg\)/i);
          if (weightMatch) {
            weightInKg = weightMatch[1];
          }

          // Assign priority ranking (1, 2, 3, 4...)
          const priority = index + 1;

          carriers.push({
            carrier_id: carrierId,
            carrier_name: carrierName,
            status: status,
            weight_in_kg: weightInKg,
            priority: priority,
            account_code: this.accountCode || 'STRI' // Multi-store: Tag carrier with account_code
          });

          console.log(`  - Extracted: ${carrierId} - ${carrierName} (${status}) - Weight: ${weightInKg || 'N/A'} - Priority: ${priority}`);
        } catch (carrierError) {
          console.error(`  - Error processing carrier ${index}:`, carrierError.message);
        }
      });

      console.log('✅ SHIPWAY CARRIER: Data extraction completed');
      console.log('  - Total carriers extracted:', carriers.length);

      return carriers;
    } catch (error) {
      console.error('💥 SHIPWAY CARRIER: Error extracting carrier data:', error.message);
      throw new Error(`Failed to extract carrier data: ${error.message}`);
    }
  }

  /**
   * Save carriers to MySQL database
   * @param {Array} carriers - Array of carrier data
   */
  async saveCarriersToDatabase(carriers) {
    try {
      // Wait for MySQL initialization to complete
      const isAvailable = await database.waitForMySQLInitialization();
      if (!isAvailable) {
        throw new Error('MySQL connection not available. Please ensure MySQL is running and configured.');
      }

      console.log('🔵 SHIPWAY CARRIER: Saving carriers to MySQL...');
      
      const result = await database.bulkUpsertCarriers(carriers);
      
      console.log('✅ SHIPWAY CARRIER: Carriers saved to MySQL');
      console.log('  - Total carriers processed:', result.total);
      console.log('  - Inserted:', result.inserted);
      console.log('  - Updated:', result.updated);

      return {
        success: true,
        message: `Successfully saved ${result.total} carriers to MySQL (${result.inserted} inserted, ${result.updated} updated)`,
        database: 'MySQL',
        carrierCount: result.total,
        inserted: result.inserted,
        updated: result.updated
      };
    } catch (error) {
      console.error('💥 SHIPWAY CARRIER: Error saving to MySQL:', error.message);
      throw new Error(`Failed to save carriers to database: ${error.message}`);
    }
  }


  /**
   * Main function to fetch and save carriers to MySQL
   * Preserves admin-set priorities and only adds new carriers
   * @returns {Promise<Object>} Result of the operation
   */
  async syncCarriersToMySQL() {
    try {
      console.log('🔵 SHIPWAY CARRIER: Starting smart carrier sync to MySQL...');
      
      // Read existing carriers from database (preserves admin-set priorities)
      const existingCarriers = await this.readCarriersFromDatabase();
      const existingCarrierMap = new Map(existingCarriers.map(carrier => [carrier.carrier_id, carrier]));
      
      console.log(`📊 Existing carriers: ${existingCarriers.length}`);
      console.log(`📊 Existing carrier IDs: ${Array.from(existingCarrierMap.keys()).join(', ')}`);
      
      // Fetch carriers from Shipway API
      const shipwayData = await this.fetchCarriersFromShipway();
      const newCarriersFromAPI = this.extractCarrierData(shipwayData);
      const newCarrierMap = new Map(newCarriersFromAPI.map(carrier => [carrier.carrier_id, carrier]));
      
      console.log(`📊 New carriers from API: ${newCarriersFromAPI.length}`);
      console.log(`📊 New carrier IDs: ${Array.from(newCarrierMap.keys()).join(', ')}`);
      
      // Find new carriers (not in existing database)
      const newCarrierIds = newCarriersFromAPI.filter(carrier => !existingCarrierMap.has(carrier.carrier_id));
      console.log(`📊 New carrier IDs to add: ${newCarrierIds.map(c => c.carrier_id).join(', ')}`);
      
      // Find removed carriers (in existing database but not in API)
      const removedCarrierIds = existingCarriers.filter(carrier => !newCarrierMap.has(carrier.carrier_id));
      console.log(`📊 Removed carrier IDs: ${removedCarrierIds.map(c => c.carrier_id).join(', ')}`);
      
      // Calculate next available priority for new carriers
      const existingPriorities = existingCarriers.map(c => parseInt(c.priority) || 0);
      const maxPriority = Math.max(0, ...existingPriorities);
      let nextPriority = maxPriority + 1;
      
      console.log(`📊 Next available priority: ${nextPriority}`);
      
      // Build final carrier list
      const finalCarriers = [];
      
      // 1. Process existing carriers (preserve priorities, update status)
      // Only process carriers that belong to this store (filter by account_code)
      existingCarriers
        .filter(carrier => !this.accountCode || carrier.account_code === this.accountCode)
        .forEach(existingCarrier => {
          const apiCarrier = newCarrierMap.get(existingCarrier.carrier_id);
          
          if (apiCarrier) {
            // Carrier still exists in API - keep priority, update status
            finalCarriers.push({
              ...existingCarrier,
              account_code: this.accountCode || existingCarrier.account_code, // Ensure account_code is set
              status: apiCarrier.status, // Update status from Shipway
              carrier_name: apiCarrier.carrier_name, // Update name if changed
              weight_in_kg: apiCarrier.weight_in_kg // Update weight if changed
            });
          }
          // If carrier doesn't exist in API, it will be removed (not added to finalCarriers)
        });
      
      // 2. Add new carriers with next available priority
      newCarrierIds.forEach(newCarrier => {
        finalCarriers.push({
          ...newCarrier,
          account_code: this.accountCode || newCarrier.account_code, // Ensure account_code is set
          priority: nextPriority++
        });
        console.log(`➕ Added new carrier: ${newCarrier.carrier_id} with priority ${nextPriority - 1}`);
      });
      
      // 3. Re-sort by priority and renumber if there are gaps
      finalCarriers.sort((a, b) => {
        const priorityA = parseInt(a.priority) || 0;
        const priorityB = parseInt(b.priority) || 0;
        return priorityA - priorityB;
      });
      
      // 4. Renumber priorities to be sequential (1, 2, 3...)
      finalCarriers.forEach((carrier, index) => {
        carrier.priority = index + 1;
      });
      
      // Filter final carriers to only include carriers for this store
      const storeCarriers = finalCarriers.filter(carrier => 
        !this.accountCode || carrier.account_code === this.accountCode
      );
      
      console.log(`📊 Final carriers for store ${this.accountCode || 'all'}: ${storeCarriers.length}`);
      console.log(`📊 Final priorities: ${storeCarriers.map(c => `${c.carrier_id}:${c.priority}`).join(', ')}`);
      
      // Save to MySQL database (only save carriers for this store)
      const result = await this.saveCarriersToDatabase(storeCarriers);
      
      // Normalize priorities after sync to ensure continuity (1, 2, 3...)
      if (this.accountCode && storeCarriers.length > 0) {
        await this.normalizeCarrierPriorities(this.accountCode);
      }
      
      // Update carrierCount to reflect only this store's carriers
      result.carrierCount = storeCarriers.length;
      
      console.log('✅ SHIPWAY CARRIER: Smart carrier sync completed');
      console.log(`📊 Summary: ${newCarrierIds.length} added, ${removedCarrierIds.length} removed, ${storeCarriers.length} total for store ${this.accountCode || 'all'}`);
      
      return result;
    } catch (error) {
      console.error('💥 SHIPWAY CARRIER: Error syncing carriers to MySQL:', error.message);
      throw error;
    }
  }

  /**
   * Main function to fetch and save carriers (backward compatibility)
   * @returns {Promise<Object>} Result of the operation
   */
  async syncCarriersToExcel() {
    // Redirect to MySQL sync method
    return await this.syncCarriersToMySQL();
  }

  /**
   * Read carriers from MySQL database
   * @returns {Promise<Array>} Array of carrier data
   */
  async readCarriersFromDatabase() {
    try {
      // Wait for MySQL initialization to complete
      const isAvailable = await database.waitForMySQLInitialization();
      if (!isAvailable) {
        throw new Error('MySQL connection not available. Please ensure MySQL is running and configured.');
      }

      // Filter carriers by account_code if available (multi-store support)
      let carriers;
      if (this.accountCode) {
        carriers = await database.getCarriersByAccountCode(this.accountCode);
        console.log(`✅ SHIPWAY CARRIER: Carriers loaded from MySQL for store: ${this.accountCode}`);
      } else {
        // Legacy mode: get all carriers
        carriers = await database.getAllCarriers();
        console.log('✅ SHIPWAY CARRIER: Carriers loaded from MySQL (all stores)');
      }
      
      console.log('  - Total carriers:', carriers.length);
      console.log('  - Ordered by priority (admin-set priorities)');

      return carriers;
    } catch (error) {
      console.error('💥 SHIPWAY CARRIER: Error reading from MySQL:', error.message);
      throw new Error(`Failed to read carriers from database: ${error.message}`);
    }
  }


  /**
   * Export carriers data to CSV format
   * @returns {Promise<string>} CSV formatted string
   */
  async exportCarriersToCSV() {
    try {
      const carriers = await this.readCarriersFromDatabase();
      
      if (!carriers || carriers.length === 0) {
        throw new Error('No carrier data found');
      }

      // Sort carriers for CSV export: actives first by priority 1..N, then inactives
      const normalizeStatus = (s) => String(s || '').trim().toLowerCase();
      const sortedCarriers = [...carriers].sort((a, b) => {
        const aActive = normalizeStatus(a.status) === 'active';
        const bActive = normalizeStatus(b.status) === 'active';
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        const priorityA = parseInt(a.priority) || 0;
        const priorityB = parseInt(b.priority) || 0;
        return priorityA - priorityB;
      });

      console.log('📊 CSV Export: Carriers sorted by priority (1, 2, 3...)');

      // Define headers with store info first, then carrier details
      const headers = [
        'store_name',
        'account_code',
        'carrier_id',
        'carrier_name',
        'status',
        'weight_in_kg',
        'priority'
      ];
      
      // Create CSV header row
      const csvHeader = headers.join(',');
      
      // Create CSV data rows
      const csvRows = sortedCarriers.map(carrier => {
        return headers.map(header => {
          const value = carrier[header] !== undefined && carrier[header] !== null ? carrier[header] : '';
          // Escape quotes and wrap in quotes if contains comma or newline
          const escapedValue = String(value).replace(/"/g, '""');
          return `"${escapedValue}"`;
        }).join(',');
      });
      
      // Combine header and data rows
      const csvContent = [csvHeader, ...csvRows].join('\n');
      
      return csvContent;
    } catch (error) {
      console.error('Error exporting carriers to CSV:', error);
      throw error;
    }
  }

  /**
   * Update carrier priorities from CSV content
   * @param {string} csvContent - CSV content with carrier_id and priority columns
   * @returns {Promise<Object>} Result object with success status and message
   */
  async updateCarrierPrioritiesFromCSV(csvContent) {
    try {
      console.log('🔍 CSV Content received:', csvContent.substring(0, 200) + '...');
      console.log('🔍 CSV Content length:', csvContent.length);
      
      // Normalize line endings and parse CSV content
      const normalizedContent = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalizedContent.trim().split('\n');
      console.log('🔍 Number of lines:', lines.length);
      
      if (lines.length < 2) {
        throw new Error('CSV file must contain header and at least one data row');
      }

      // Parse header - handle quoted values properly
      const headerLine = lines[0];
      const header = this.parseCSVLine(headerLine);
      console.log('🔍 Parsed header:', header);
      
      // Validate required columns exist
      const requiredColumns = ['carrier_id', 'carrier_name', 'status', 'weight_in_kg', 'priority'];
      const missingColumns = requiredColumns.filter(col => !header.includes(col));
      
      if (missingColumns.length > 0) {
        throw new Error(`CSV is missing required columns: ${missingColumns.join(', ')}. Expected columns: ${requiredColumns.join(', ')}`);
      }

      // account_code is REQUIRED for multi-store upload
      const accountCodeIndex = header.indexOf('account_code');
      if (accountCodeIndex === -1) {
        throw new Error('CSV must include "account_code" column for multi-store carrier priority upload');
      }

      const carrierIdIndex = header.indexOf('carrier_id');
      const priorityIndex = header.indexOf('priority');
      const statusIndex = header.indexOf('status');

      console.log('🔍 carrier_id index:', carrierIdIndex);
      console.log('🔍 priority index:', priorityIndex);
      console.log('🔍 account_code index:', accountCodeIndex);

      // Read ALL carriers from database (for validation across all stores)
      // Use database directly to get all carriers regardless of accountCode
      const allCarriers = await database.getAllCarriers();
      
      // Group carriers by account_code for validation
      const carriersByStore = new Map();
      allCarriers.forEach(carrier => {
        if (!carriersByStore.has(carrier.account_code)) {
          carriersByStore.set(carrier.account_code, []);
        }
        carriersByStore.get(carrier.account_code).push(carrier);
      });

      // Parse data rows and group by store (account_code)
      const updatesByStore = new Map(); // Map<account_code, Array<update>>
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const values = this.parseCSVLine(line);
        const carrierId = values[carrierIdIndex];
        const priority = parseInt(values[priorityIndex]);
        const statusRaw = values[statusIndex] || '';
        const statusNormalized = String(statusRaw).trim().toLowerCase();
        const status = statusNormalized === 'inactive' ? 'inactive' : (statusNormalized === 'active' ? 'active' : statusRaw);
        const accountCode = values[accountCodeIndex];

        console.log(`🔍 Row ${i}: carrier_id="${carrierId}", account_code="${accountCode}", priority="${values[priorityIndex]}" -> ${priority}`);

        if (!carrierId || !accountCode || isNaN(priority) || priority < 1) {
          throw new Error(`Invalid data in row ${i + 1}: carrier_id="${carrierId}", account_code="${accountCode}", priority="${values[priorityIndex]}"`);
        }

        // Initialize store group if not exists
        if (!updatesByStore.has(accountCode)) {
          updatesByStore.set(accountCode, []);
        }

        // Check if carrier ID exists in current data for THIS STORE
        const storeCarriers = carriersByStore.get(accountCode) || [];
        const carrierExists = storeCarriers.some(c => String(c.carrier_id) === String(carrierId));
        
        if (!carrierExists) {
          throw new Error(`Carrier ID "${carrierId}" in row ${i + 1} does not exist in the current carrier data for store "${accountCode}"`);
        }

        // Check for duplicate carrier IDs in uploaded CSV (within the same store)
        const storeUpdates = updatesByStore.get(accountCode);
        const duplicateInStore = storeUpdates.some(u => String(u.carrier_id) === String(carrierId));
        
        if (duplicateInStore) {
          throw new Error(`Duplicate carrier ID "${carrierId}" found in uploaded CSV for store "${accountCode}" (row ${i + 1}). Each carrier can only appear once per store.`);
        }

        storeUpdates.push({ carrier_id: carrierId, account_code: accountCode, priority, status });
      }

      console.log('🔍 Updates grouped by store:', Array.from(updatesByStore.entries()).map(([code, updates]) => `${code}: ${updates.length} carriers`));

      if (updatesByStore.size === 0) {
        throw new Error('No valid data rows found in CSV');
      }

      // Validate and update each store separately
      const results = [];
      let totalUpdated = 0;

      for (const [accountCode, updates] of updatesByStore.entries()) {
        const storeCarriers = carriersByStore.get(accountCode) || [];
        const existingCarrierIds = new Set(storeCarriers.map(c => String(c.carrier_id)));
        const uploadedCarrierIds = new Set(updates.map(u => String(u.carrier_id)));

        // Validate that ALL existing carrier IDs for THIS STORE are present in the uploaded CSV
        const missingCarrierIds = Array.from(existingCarrierIds).filter(id => !uploadedCarrierIds.has(id));
        if (missingCarrierIds.length > 0) {
          throw new Error(`Uploaded CSV is missing the following carrier IDs for store "${accountCode}": ${missingCarrierIds.join(', ')}. All existing carriers for this store must be included in the CSV.`);
        }

        // Validate priority values are unique within this store
        const priorityValues = updates.map(update => update.priority);
        const uniquePriorities = new Set(priorityValues);
        if (uniquePriorities.size !== priorityValues.length) {
          throw new Error(`Priority values must be unique within store "${accountCode}". Duplicate priority values found in uploaded CSV.`);
        }

        // Update priorities in database for this store (store-specific)
        let storeUpdatedCount = 0;
        for (const update of updates) {
          // Get carrier by both carrier_id and account_code to ensure store-specific lookup
          const existing = await database.getCarrierById(update.carrier_id, accountCode);
          if (existing && String(existing.account_code) === String(accountCode)) {
            const updateData = { 
              priority: update.priority,
              account_code: accountCode // Ensure account_code is set
            };
            if (update.status) {
              updateData.status = update.status;
            }
            // Update with account_code to ensure store-specific update
            await database.updateCarrier(update.carrier_id, updateData, accountCode);
            storeUpdatedCount++;
          } else {
            console.warn(`⚠️ Carrier ${update.carrier_id} not found for store ${accountCode}`);
          }
        }

        // Normalize priorities after updating to ensure continuity (1, 2, 3...)
        if (storeUpdatedCount > 0) {
          await this.normalizeCarrierPriorities(accountCode);
          console.log(`✅ Store "${accountCode}": Normalized priorities after update`);
        }

        totalUpdated += storeUpdatedCount;
        results.push({
          accountCode,
          updatedCount: storeUpdatedCount,
          totalCarriers: storeCarriers.length
        });

        console.log(`✅ Store "${accountCode}": Updated ${storeUpdatedCount}/${updates.length} carriers`);
      }

      const storeSummary = results.map(r => `${r.accountCode}: ${r.updatedCount}/${r.totalCarriers}`).join(', ');

      return {
        success: true,
        message: `Successfully updated priorities for ${totalUpdated} carriers across ${results.length} store(s). ${storeSummary}`,
        updatedCount: totalUpdated,
        totalCarriers: allCarriers.length,
        storesProcessed: results.length,
        validation: {
          totalCarriersInDatabase: allCarriers.length,
          totalCarriersInCSV: Array.from(updatesByStore.values()).reduce((sum, updates) => sum + updates.length, 0),
          storesUpdated: results.map(r => r.accountCode),
          duplicatePriorities: false
        }
      };
    } catch (error) {
      console.error('Error updating carrier priorities from CSV:', error);
      throw error;
    }
  }

  /**
   * Move a carrier up or down in priority ordering
   * @param {string} carrierId
   * @param {'up'|'down'} direction
   * @returns {Promise<Object>} Result object
   */
  async moveCarrier(carrierId, direction, accountCode = null) {
    try {
      // If accountCode is provided, use it to filter carriers by store
      // Otherwise, use this.accountCode from the service instance
      const storeAccountCode = accountCode || this.accountCode;
      
      if (!storeAccountCode) {
        throw new Error('account_code is required for moving carriers. Please specify a store.');
      }

      const carriers = await this.readCarriersFromDatabase();
      const normalizeStatus = (s) => String(s || '').trim().toLowerCase();

      // Filter by store (account_code) AND status
      const active = carriers
        .filter(c => {
          const matchesStore = c.account_code === storeAccountCode;
          const matchesStatus = normalizeStatus(c.status) === 'active';
          return matchesStore && matchesStatus;
        })
        .sort((a, b) => (parseInt(a.priority) || 0) - (parseInt(b.priority) || 0));

      const index = active.findIndex(c => String(c.carrier_id) === String(carrierId));
      if (index === -1) {
        throw new Error('Carrier not found or not active in the selected store');
      }
      if (direction === 'up' && index === 0) {
        return { success: true, message: 'Already at top' };
      }
      if (direction === 'down' && index === active.length - 1) {
        return { success: true, message: 'Already at bottom' };
      }

      // Create a new array with the moved carrier
      const newOrder = [...active];
      const movedCarrier = newOrder[index];
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      
      // Remove the carrier from its current position
      newOrder.splice(index, 1);
      // Insert it at the new position
      newOrder.splice(newIndex, 0, movedCarrier);

      // Update priorities sequentially (1, 2, 3, ...) - only for this store's carriers
      await database.reorderCarrierPriorities(newOrder, storeAccountCode);

      return { success: true, message: 'Carrier moved successfully' };
    } catch (error) {
      console.error('Error moving carrier:', error.message);
      throw new Error(error.message || 'Failed to move carrier');
    }
  }

  /**
   * Normalize carrier priorities to be sequential (1, 2, 3, ...) for a specific store
   * This fixes any gaps or duplicates in priority values
   * @param {string} accountCode - Optional. Store account code. If not provided, uses this.accountCode
   * @returns {Promise<Object>} Result object
   */
  async normalizeCarrierPriorities(accountCode = null) {
    try {
      const storeAccountCode = accountCode || this.accountCode;
      
      if (!storeAccountCode) {
        throw new Error('account_code is required for normalizing priorities. Please specify a store.');
      }

      const carriers = await this.readCarriersFromDatabase();
      const normalizeStatus = (s) => String(s || '').trim().toLowerCase();

      // Filter by store (account_code) AND status
      const active = carriers
        .filter(c => {
          const matchesStore = c.account_code === storeAccountCode;
          const matchesStatus = normalizeStatus(c.status) === 'active';
          return matchesStore && matchesStatus;
        })
        .sort((a, b) => (parseInt(a.priority) || 0) - (parseInt(b.priority) || 0));

      if (active.length === 0) {
        return { success: true, message: `No active carriers to normalize for store ${storeAccountCode}` };
      }

      // Check if normalization is needed
      let needsNormalization = false;
      for (let i = 0; i < active.length; i++) {
        const expectedPriority = i + 1;
        const actualPriority = parseInt(active[i].priority) || 0;
        if (actualPriority !== expectedPriority) {
          needsNormalization = true;
          break;
        }
      }

      if (!needsNormalization) {
        return { success: true, message: `Priorities are already normalized for store ${storeAccountCode}` };
      }

      // Normalize priorities (store-specific)
      await database.reorderCarrierPriorities(active, storeAccountCode);

      return { success: true, message: `Normalized priorities for ${active.length} active carriers in store ${storeAccountCode}` };
    } catch (error) {
      console.error('Error normalizing carrier priorities:', error.message);
      throw new Error(error.message || 'Failed to normalize carrier priorities');
    }
  }

  /**
   * Get expected CSV format and current carrier data for validation
   * @returns {Promise<Object>} Expected format and current data
   */
  async getExpectedCSVFormat() {
    try {
      const currentCarriers = await this.readCarriersFromDatabase();
      
      return {
        success: true,
        expectedColumns: ['carrier_id', 'carrier_name', 'status', 'weight_in_kg', 'priority'],
        totalCarriers: currentCarriers.length,
        sampleData: currentCarriers.slice(0, 3), // First 3 carriers as example
        validationRules: [
          'All 5 columns must be present: carrier_id, carrier_name, status, weight_in_kg, priority',
          'All existing carrier IDs must be included in the CSV',
          'No duplicate carrier IDs allowed',
          'Priority values must be unique (no duplicates)',
          'Priority values must be positive integers',
          'Carrier IDs must match exactly with existing data'
        ]
      };
    } catch (error) {
      console.error('Error getting expected CSV format:', error);
      throw error;
    }
  }

  /**
   * Parse a CSV line properly handling quoted values
   * @param {string} line - CSV line to parse
   * @returns {Array} Array of values
   */
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    result.push(current.trim());
    
    return result;
  }
}

// Default instance for legacy callers (no account_code context)
const defaultShipwayCarrierService = new ShipwayCarrierService();

// Export default instance (backward compatible) and also the class for multi-store usage
module.exports = defaultShipwayCarrierService;
module.exports.ShipwayCarrierService = ShipwayCarrierService; 