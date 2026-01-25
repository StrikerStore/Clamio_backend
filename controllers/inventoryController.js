const database = require('../config/database');

/**
 * Inventory Controller
 * Handles inventory aggregation for unclaimed orders
 */

/**
 * Size order for sorting
 */
const SIZE_ORDER = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

/**
 * Sort size-quantity pairs by size order
 * @param {string} sizeQuantityStr - Size-quantity string like "M-7, S-4, XL-2"
 * @returns {string} Sorted string like "S-4, M-7, XL-2"
 */
function sortSizeQuantities(sizeQuantityStr) {
  if (!sizeQuantityStr) return '';

  // Split by comma
  const pairs = sizeQuantityStr.split(',').map(p => p.trim()).filter(p => p);

  // Sort by SIZE_ORDER
  const sorted = pairs.sort((a, b) => {
    const sizeA = a.split('-')[0].trim().toUpperCase();
    const sizeB = b.split('-')[0].trim().toUpperCase();

    const indexA = SIZE_ORDER.indexOf(sizeA);
    const indexB = SIZE_ORDER.indexOf(sizeB);

    // If size not in SIZE_ORDER, put at end
    if (indexA === -1 && indexB === -1) return 0;
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;

    return indexA - indexB;
  });

  return sorted.join(', ');
}

/**
 * Detect if product name contains Player or Fan
 * @param {string} productName - Product name
 * @returns {string} Prefix ('Player', 'Fan', or '')
 */
function detectProductPrefix(productName) {
  if (!productName) return '';

  const lowerName = productName.toLowerCase();
  if (lowerName.includes('player')) return 'Player';
  if (lowerName.includes('fan')) return 'Fan';

  return '';
}

/**
 * Get aggregated inventory for unclaimed orders
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getAggregatedInventory(req, res) {
  try {
    console.log('📊 Fetching aggregated inventory for unclaimed orders...');

    // Query unclaimed orders with products (only from active stores)
    const query = `
      SELECT 
        o.product_name,
        o.product_code,
        o.size,
        o.quantity,
        p.name as product_display_name,
        p.image as product_image,
        p.sku_id as base_sku
      FROM orders o
      LEFT JOIN products p ON (
        (REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_](XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXXL|XXL|Small|Medium|Large|Extra Large)$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+-[0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id OR
        REGEXP_REPLACE(TRIM(REGEXP_REPLACE(o.product_code, '[-_][0-9]+$', '')), '[-_]{2,}', '-') = p.sku_id)
        AND o.account_code = p.account_code
      )
      LEFT JOIN claims c ON o.unique_id = c.order_unique_id AND o.account_code = c.account_code
      LEFT JOIN store_info s ON o.account_code = s.account_code
      WHERE (c.status = 'unclaimed' OR c.status IS NULL)
        AND o.is_in_new_order = 1
        AND s.status = 'active'
      ORDER BY o.product_name, o.size
    `;

    const orders = await database.query(query);

    console.log(`📦 Found ${orders.length} unclaimed order items`);

    // Group by base product (using cleaned SKU)
    const productMap = new Map();

    for (const order of orders) {
      // Get base SKU (clean product_code)
      const baseSku = database.cleanSkuId(order.product_code) || order.base_sku || order.product_code;

      if (!productMap.has(baseSku)) {
        // Initialize product entry
        const productName = order.product_display_name || order.product_name;
        const prefix = detectProductPrefix(productName);

        productMap.set(baseSku, {
          productName: productName,
          baseProductName: database.removeSizeFromProductName(productName),
          imageUrl: order.product_image || null,
          baseSku: baseSku,
          prefix: prefix,
          sizes: new Map(), // size -> total quantity
        });
      }

      const product = productMap.get(baseSku);

      // Aggregate quantities by size
      const size = (order.size || 'Unknown').toUpperCase();
      const currentQty = product.sizes.get(size) || 0;
      product.sizes.set(size, currentQty + parseInt(order.quantity || 0));
    }

    // Convert to array and format size-quantity string
    const products = Array.from(productMap.values()).map(product => {
      // Build size-quantity string
      const sizeQuantityPairs = Array.from(product.sizes.entries())
        .map(([size, qty]) => `${size}-${qty}`);

      // Sort sizes
      const sortedSizeQuantity = sortSizeQuantities(sizeQuantityPairs.join(', '));

      // Add prefix (Player/Fan) if detected
      const finalSizeQuantity = product.prefix
        ? `${product.prefix} ${sortedSizeQuantity}`
        : sortedSizeQuantity;

      return {
        productName: product.productName,
        baseProductName: product.baseProductName,
        imageUrl: product.imageUrl,
        baseSku: product.baseSku,
        sizeQuantity: finalSizeQuantity,
        prefix: product.prefix
      };
    });

    // Sort by product name
    products.sort((a, b) => a.productName.localeCompare(b.productName));

    console.log(`✅ Aggregated ${products.length} unique products`);

    res.json({
      success: true,
      data: {
        totalProducts: products.length,
        products: products
      }
    });

  } catch (error) {
    console.error('❌ Error fetching aggregated inventory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory data',
      message: error.message
    });
  }
}

/**
 * Upload and parse RTO CSV file
 * @param {Object} req - Express request with file upload
 * @param {Object} res - Express response
 */
async function uploadRTODetails(req, res) {
  try {
    console.log('📤 Processing RTO details upload...');

    // Check if file is uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const csvData = req.file.buffer.toString('utf-8');

    // Parse CSV (simple parsing - handle both \n and \r\n line endings)
    const lines = csvData
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0); // Remove empty lines

    if (lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'CSV file is empty'
      });
    }

    const headers = lines[0].split(',').map(h => h.trim());

    // Map column indices based on CSV structure
    const productNameIndex = headers.findIndex(h => h.toLowerCase().includes('product_n'));
    const variantSkuIndex = headers.findIndex(h => h.toLowerCase().includes('variant_sk'));
    const sizeIndex = headers.findIndex(h => h.toLowerCase() === 'size');
    const quantityIndex = headers.findIndex(h => h.toLowerCase() === 'quantity');
    const locationIndex = headers.findIndex(h => h.toLowerCase() === 'location');

    console.log('📋 CSV Headers:', headers);
    console.log('📋 Column indices:', { productNameIndex, variantSkuIndex, sizeIndex, quantityIndex, locationIndex });

    // Validate required columns
    if (productNameIndex < 0 || sizeIndex < 0 || quantityIndex < 0 || locationIndex < 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required columns. Expected: Product_Name, Size, Quantity, Location'
      });
    }

    const rtoData = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());

      // Skip empty rows
      if (values.length < 4 || values.every(v => !v)) {
        continue;
      }

      const row = {
        Product_Name: values[productNameIndex] || '',
        Location: values[locationIndex] || '',
        Size: values[sizeIndex] || '',
        Quantity: values[quantityIndex] || ''
      };

      // Only add row if it has at least Product_Name and Location
      if (row.Product_Name || row.Location) {
        rtoData.push(row);
      }
    }

    console.log(`✅ Parsed ${rtoData.length} RTO entries`);

    res.json({
      success: true,
      data: {
        totalEntries: rtoData.length,
        rtoData: rtoData
      }
    });

  } catch (error) {
    console.error('❌ Error processing RTO upload:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process RTO file',
      message: error.message
    });
  }
}

/**
 * Get RTO inventory from database with product names
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getRTOInventory(req, res) {
  try {
    console.log('📊 Fetching RTO inventory from database...');

    const rtoData = await database.getRTOInventoryWithProductNames();

    console.log(`✅ Fetched ${rtoData.length} RTO entries`);

    res.json({
      success: true,
      data: {
        totalEntries: rtoData.length,
        rtoData: rtoData
      }
    });

  } catch (error) {
    console.error('❌ Error fetching RTO inventory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch RTO inventory',
      message: error.message
    });
  }
}

module.exports = {
  getAggregatedInventory,
  uploadRTODetails,
  getRTOInventory
};
