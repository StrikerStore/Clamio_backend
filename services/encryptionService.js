/**
 * Encryption Service
 * Handles encryption and decryption of sensitive data (passwords)
 * Uses AES-256-GCM algorithm
 */

const crypto = require('crypto');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 16; // For AES, this is always 16
    this.saltLength = 64;
    this.tagLength = 16;
    this.tagPosition = this.saltLength + this.ivLength;
    this.encryptedPosition = this.tagPosition + this.tagLength;
    
    // Get encryption key from environment variable
    this.encryptionKey = process.env.ENCRYPTION_KEY;
    
    if (!this.encryptionKey) {
      console.warn('⚠️ WARNING: ENCRYPTION_KEY not set in environment variables!');
      console.warn('⚠️ Using a temporary key - THIS IS NOT SECURE FOR PRODUCTION!');
      // Generate a temporary key for development (NOT SECURE FOR PRODUCTION)
      this.encryptionKey = crypto.randomBytes(32).toString('hex');
    }
  }

  /**
   * Derive a key from the encryption key and salt using PBKDF2
   * @param {Buffer} salt - Salt for key derivation
   * @returns {Buffer} Derived key
   */
  getKey(salt) {
    return crypto.pbkdf2Sync(
      this.encryptionKey,
      salt,
      100000, // iterations
      32, // key length
      'sha512'
    );
  }

  /**
   * Encrypt a plain text string
   * @param {string} plainText - The text to encrypt
   * @returns {string} Encrypted text in hex format
   * @throws {Error} If encryption fails
   */
  encrypt(plainText) {
    try {
      if (!plainText || typeof plainText !== 'string') {
        throw new Error('Plain text must be a non-empty string');
      }

      // Generate random salt and IV
      const salt = crypto.randomBytes(this.saltLength);
      const iv = crypto.randomBytes(this.ivLength);
      
      // Derive key from password and salt
      const key = this.getKey(salt);
      
      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      
      // Encrypt the text
      const encrypted = Buffer.concat([
        cipher.update(plainText, 'utf8'),
        cipher.final()
      ]);
      
      // Get the auth tag
      const tag = cipher.getAuthTag();
      
      // Combine salt + iv + tag + encrypted data
      const result = Buffer.concat([salt, iv, tag, encrypted]);
      
      // Return as hex string
      return result.toString('hex');
      
    } catch (error) {
      console.error('❌ Encryption error:', error.message);
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt an encrypted string
   * @param {string} encryptedText - The encrypted text in hex format
   * @returns {string} Decrypted plain text
   * @throws {Error} If decryption fails
   */
  decrypt(encryptedText) {
    try {
      if (!encryptedText || typeof encryptedText !== 'string') {
        throw new Error('Encrypted text must be a non-empty string');
      }

      // Convert hex string to buffer
      const data = Buffer.from(encryptedText, 'hex');
      
      // Extract salt, iv, tag, and encrypted data
      const salt = data.slice(0, this.saltLength);
      const iv = data.slice(this.saltLength, this.tagPosition);
      const tag = data.slice(this.tagPosition, this.encryptedPosition);
      const encrypted = data.slice(this.encryptedPosition);
      
      // Derive key from password and salt
      const key = this.getKey(salt);
      
      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(tag);
      
      // Decrypt the data
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      
      // Return as UTF-8 string
      return decrypted.toString('utf8');
      
    } catch (error) {
      console.error('❌ Decryption error:', error.message);
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Test the encryption/decryption functionality
   * @returns {boolean} True if test passes
   */
  test() {
    try {
      const testString = 'Test encryption string 123!@#';
      const encrypted = this.encrypt(testString);
      const decrypted = this.decrypt(encrypted);
      
      if (testString === decrypted) {
        console.log('✅ Encryption service test passed');
        return true;
      } else {
        console.error('❌ Encryption service test failed: decrypted text does not match');
        return false;
      }
    } catch (error) {
      console.error('❌ Encryption service test failed:', error.message);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new EncryptionService();

