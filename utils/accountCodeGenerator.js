/**
 * Account Code Generator Utility
 * Generates unique account codes from store names
 */

/**
 * Generate account_code from store name
 * Rules:
 * - Remove spaces and special characters
 * - Take first 4 alphanumeric characters
 * - Convert to UPPERCASE
 * 
 * @param {string} storeName - The store name
 * @returns {string} Generated account code (e.g., "STRI")
 * @throws {Error} If store name is invalid
 */
function generateAccountCodeFromName(storeName) {
  if (!storeName || typeof storeName !== 'string') {
    throw new Error('Invalid store name: must be a non-empty string');
  }
  
  // Remove spaces and special characters, keep only alphanumeric
  const cleanName = storeName.replace(/[^a-zA-Z0-9]/g, '');
  
  if (cleanName.length === 0) {
    throw new Error('Store name must contain at least one alphanumeric character');
  }
  
  // Take first 4 characters and convert to uppercase
  const baseCode = cleanName.substring(0, 4).toUpperCase();
  
  return baseCode;
}

/**
 * Generate unique account_code by checking database
 * If base code exists, appends number (2, 3, 4...)
 * 
 * @param {string} storeName - The store name
 * @param {object} database - Database instance
 * @returns {Promise<string>} Unique account code (e.g., "STRI" or "STRI2")
 * @throws {Error} If unable to generate unique code
 */
async function generateUniqueAccountCode(storeName, database) {
  const baseCode = generateAccountCodeFromName(storeName);
  
  // Check if base code exists
  const existingStore = await database.getStoreByAccountCode(baseCode);
  
  if (!existingStore) {
    // Base code is available
    console.log(`✅ Generated account code: ${baseCode}`);
    return baseCode;
  }
  
  // Base code exists, find next available number
  console.log(`⚠️ Account code ${baseCode} already exists, finding alternative...`);
  
  let counter = 2;
  let uniqueCode = `${baseCode}${counter}`;
  
  while (counter <= 100) {
    const store = await database.getStoreByAccountCode(uniqueCode);
    
    if (!store) {
      // Found unique code
      console.log(`✅ Generated unique account code: ${uniqueCode}`);
      return uniqueCode;
    }
    
    counter++;
    uniqueCode = `${baseCode}${counter}`;
  }
  
  // Safety check - should never reach here in normal operation
  throw new Error(`Unable to generate unique account code for "${storeName}". Too many stores with similar names (checked up to ${baseCode}100).`);
}

module.exports = {
  generateAccountCodeFromName,
  generateUniqueAccountCode
};

