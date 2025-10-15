const axios = require('axios');
const path = require('path');
const fs = require('fs');
const database = require('../config/database');

class ShipwayCarrierService {
  constructor() {
    this.apiUrl = 'https://app.shipway.com/api/getcarrier';
    // Use the same Basic Auth header as other Shipway APIs
    this.basicAuthHeader = process.env.SHIPWAY_BASIC_AUTH_HEADER;
  }

  /**
   * Fetch carriers from Shipway API
   * @returns {Promise<Array>} Array of carrier data
   */
  async fetchCarriersFromShipway() {
    try {
      console.log('🔵 SHIPWAY CARRIER: Fetching carriers from Shipway API...');
      
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
            priority: priority
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
      existingCarriers.forEach(existingCarrier => {
        const apiCarrier = newCarrierMap.get(existingCarrier.carrier_id);
        
        if (apiCarrier) {
          // Carrier still exists in API - keep priority, update status
          finalCarriers.push({
            ...existingCarrier,
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
      
      console.log(`📊 Final carriers: ${finalCarriers.length}`);
      console.log(`📊 Final priorities: ${finalCarriers.map(c => `${c.carrier_id}:${c.priority}`).join(', ')}`);
      
      // Save to MySQL database
      const result = await this.saveCarriersToDatabase(finalCarriers);
      
      console.log('✅ SHIPWAY CARRIER: Smart carrier sync completed');
      console.log(`📊 Summary: ${newCarrierIds.length} added, ${removedCarrierIds.length} removed, ${finalCarriers.length} total`);
      
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

      const carriers = await database.getAllCarriers();
      
      console.log('✅ SHIPWAY CARRIER: Carriers loaded from MySQL');
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

      // Get headers from the first carrier object
      const headers = Object.keys(sortedCarriers[0]);
      
      // Create CSV header row
      const csvHeader = headers.join(',');
      
      // Create CSV data rows
      const csvRows = sortedCarriers.map(carrier => {
        return headers.map(header => {
          const value = carrier[header];
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
      console.log('🔍 First line:', lines[0]);
      console.log('🔍 Second line:', lines[1]);
      console.log('🔍 All lines:', lines);
      
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

      // Check for extra columns
      const extraColumns = header.filter(col => !requiredColumns.includes(col));
      if (extraColumns.length > 0) {
        console.log('⚠️ Warning: CSV contains extra columns:', extraColumns);
      }

      const carrierIdIndex = header.indexOf('carrier_id');
      const priorityIndex = header.indexOf('priority');
      const statusIndex = header.indexOf('status');

      console.log('🔍 carrier_id index:', carrierIdIndex);
      console.log('🔍 priority index:', priorityIndex);

      // Read current carrier data to validate against
      const currentCarriers = await this.readCarriersFromDatabase();
      const carrierMap = new Map(currentCarriers.map(carrier => [carrier.carrier_id, carrier]));
      const existingCarrierIds = new Set(currentCarriers.map(carrier => carrier.carrier_id));
      
      console.log('🔍 Existing carrier IDs:', Array.from(existingCarrierIds));

      // Parse data rows
      const updates = [];
      const uploadedCarrierIds = new Set();
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const values = this.parseCSVLine(line);
        const carrierId = values[carrierIdIndex];
        const priority = parseInt(values[priorityIndex]);
        const statusRaw = values[statusIndex] || '';
        const statusNormalized = String(statusRaw).trim().toLowerCase();
        const status = statusNormalized === 'inactive' ? 'inactive' : (statusNormalized === 'active' ? 'active' : statusRaw);

        console.log(`🔍 Row ${i}: carrier_id="${carrierId}", priority="${values[priorityIndex]}" -> ${priority}`);

        if (!carrierId || isNaN(priority) || priority < 1) {
          throw new Error(`Invalid data in row ${i + 1}: carrier_id="${carrierId}", priority="${values[priorityIndex]}"`);
        }

        // Check if carrier ID exists in current data
        if (!existingCarrierIds.has(carrierId)) {
          throw new Error(`Carrier ID "${carrierId}" in row ${i + 1} does not exist in the current carrier data`);
        }

        // Check for duplicate carrier IDs in uploaded CSV
        if (uploadedCarrierIds.has(carrierId)) {
          throw new Error(`Duplicate carrier ID "${carrierId}" found in uploaded CSV`);
        }

        uploadedCarrierIds.add(carrierId);
        updates.push({ carrier_id: carrierId, priority, status });
      }

      console.log('🔍 Valid updates found:', updates.length);
      console.log('🔍 Uploaded carrier IDs:', Array.from(uploadedCarrierIds));

      if (updates.length === 0) {
        throw new Error('No valid data rows found in CSV');
      }

      // Validate that ALL existing carrier IDs are present in the uploaded CSV
      const missingCarrierIds = Array.from(existingCarrierIds).filter(id => !uploadedCarrierIds.has(id));
      if (missingCarrierIds.length > 0) {
        throw new Error(`Uploaded CSV is missing the following carrier IDs: ${missingCarrierIds.join(', ')}. All existing carriers must be included in the CSV.`);
      }

      // Validate priority values are unique
      const priorityValues = updates.map(update => update.priority);
      const uniquePriorities = new Set(priorityValues);
      if (uniquePriorities.size !== priorityValues.length) {
        throw new Error('Priority values must be unique. Duplicate priority values found in uploaded CSV.');
      }

      // Update priorities in database
      let updatedCount = 0;
      for (const update of updates) {
        const existing = await database.getCarrierById(update.carrier_id);
        if (existing) {
          const updateData = { priority: update.priority };
          if (update.status) {
            updateData.status = update.status;
          }
          await database.updateCarrier(update.carrier_id, updateData);
          updatedCount++;
        }
      }

      return {
        success: true,
        message: `Successfully updated priorities for ${updatedCount} carriers. All ${updates.length} carriers validated.`,
        updatedCount,
        totalCarriers: currentCarriers.length,
        validation: {
          totalCarriersInDatabase: currentCarriers.length,
          totalCarriersInCSV: updates.length,
          missingCarriers: 0,
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
  async moveCarrier(carrierId, direction) {
    try {
      const carriers = await this.readCarriersFromDatabase();
      const normalizeStatus = (s) => String(s || '').trim().toLowerCase();

      const active = carriers
        .filter(c => normalizeStatus(c.status) === 'active')
        .sort((a, b) => (parseInt(a.priority) || 0) - (parseInt(b.priority) || 0));

      const index = active.findIndex(c => String(c.carrier_id) === String(carrierId));
      if (index === -1) {
        throw new Error('Carrier not found or not active');
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

      // Update priorities sequentially (1, 2, 3, ...)
      await database.reorderCarrierPriorities(newOrder);

      return { success: true, message: 'Carrier moved successfully' };
    } catch (error) {
      console.error('Error moving carrier:', error.message);
      throw new Error(error.message || 'Failed to move carrier');
    }
  }

  /**
   * Normalize carrier priorities to be sequential (1, 2, 3, ...)
   * This fixes any gaps or duplicates in priority values
   * @returns {Promise<Object>} Result object
   */
  async normalizeCarrierPriorities() {
    try {
      const carriers = await this.readCarriersFromDatabase();
      const normalizeStatus = (s) => String(s || '').trim().toLowerCase();

      const active = carriers
        .filter(c => normalizeStatus(c.status) === 'active')
        .sort((a, b) => (parseInt(a.priority) || 0) - (parseInt(b.priority) || 0));

      if (active.length === 0) {
        return { success: true, message: 'No active carriers to normalize' };
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
        return { success: true, message: 'Priorities are already normalized' };
      }

      // Normalize priorities
      await database.reorderCarrierPriorities(active);

      return { success: true, message: `Normalized priorities for ${active.length} active carriers` };
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

module.exports = new ShipwayCarrierService(); 