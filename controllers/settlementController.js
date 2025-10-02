const database = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { validationResult } = require('express-validator');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/payment-proofs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'payment-proof-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only image files
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Mock order data calculation - In real app, this would come from orders database
const calculateVendorPayments = (vendorId) => {
  // Mock orders data - replace with actual database query
  const mockOrders = [
    { id: "ORD-001", vendorId, status: "handover", value: 299.99 },
    { id: "ORD-002", vendorId, status: "handover", value: 199.99 },
    { id: "ORD-003", vendorId, status: "in_pack", value: 89.99 },
    { id: "ORD-004", vendorId, status: "handover", value: 29.99 },
    { id: "ORD-005", vendorId, status: "in_pack", value: 49.99 }
  ];

  const currentPayment = mockOrders
    .filter(order => order.status === 'handover')
    .reduce((sum, order) => sum + order.value, 0);

  const futurePayment = mockOrders
    .filter(order => order.status === 'in_pack')
    .reduce((sum, order) => sum + order.value, 0);

  const handoverOrderIds = mockOrders
    .filter(order => order.status === 'handover')
    .map(order => order.id);

  return { currentPayment, futurePayment, handoverOrderIds };
};

// Validate UPI ID format
const isValidUpiId = (upiId) => {
  const upiRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/;
  return upiRegex.test(upiId);
};

class SettlementController {
  // Get vendor payments (current and future)
  async getVendorPayments(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const vendorId = req.user.id;
      const { currentPayment, futurePayment } = calculateVendorPayments(vendorId);

      // Get all approved settlements for this vendor to calculate settled amounts
      const settlements = await database.getSettlementsByVendor(vendorId);
      const totalSettledAmount = settlements
        .filter(settlement => settlement.status === 'approved')
        .reduce((sum, settlement) => sum + (parseFloat(settlement.amountPaid) || 0), 0);

      // Subtract settled amounts from current payment
      const adjustedCurrentPayment = Math.max(0, currentPayment - totalSettledAmount);

      res.json({
        success: true,
        data: {
          currentPayment: Math.round(adjustedCurrentPayment * 100) / 100, // Round to 2 decimal places
          futurePayment: Math.round(futurePayment * 100) / 100,
          currency: 'INR'
        }
      });
    } catch (error) {
      console.error('Error getting vendor payments:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get vendor payments'
      });
    }
  }

  // Create settlement request
  async createSettlementRequest(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { upiId } = req.body;
      const vendorId = req.user.id;
      const vendorName = req.user.name;

      // Validate UPI ID
      if (!isValidUpiId(upiId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid UPI ID format'
        });
      }

      // Calculate current payment and get order IDs
      const { currentPayment, handoverOrderIds } = calculateVendorPayments(vendorId);

      // Get all approved settlements for this vendor to calculate settled amounts
      const settlements = await database.getSettlementsByVendor(vendorId);
      const totalSettledAmount = settlements
        .filter(settlement => settlement.status === 'approved')
        .reduce((sum, settlement) => sum + (parseFloat(settlement.amountPaid) || 0), 0);

      // Calculate remaining unpaid amount
      const remainingAmount = Math.max(0, currentPayment - totalSettledAmount);

      if (remainingAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'No amount available for settlement. All eligible amounts have been settled.'
        });
      }

      // Create settlement request for remaining amount only
      const settlementData = {
        vendorId,
        vendorName,
        amount: Math.round(remainingAmount * 100) / 100,
        upiId,
        orderIds: handoverOrderIds.join(','),
        numberOfOrders: handoverOrderIds.length,
        currency: 'INR'
      };

      const settlement = await database.createSettlement(settlementData);

      res.json({
        success: true,
        message: 'Settlement request created successfully',
        data: settlement
      });
    } catch (error) {
      console.error('Error creating settlement request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create settlement request'
      });
    }
  }

  // Get vendor's settlement history
  async getVendorSettlements(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const vendorId = req.user.id;
      const settlements = await database.getSettlementsByVendor(vendorId);

      res.json({
        success: true,
        data: settlements
      });
    } catch (error) {
      console.error('Error getting vendor settlements:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get settlement history'
      });
    }
  }

  // Get vendor's transaction history
  async getVendorTransactions(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const vendorId = req.user.id;
      const transactions = await database.getTransactionsByVendor(vendorId);

      res.json({
        success: true,
        data: transactions
      });
    } catch (error) {
      console.error('Error getting vendor transactions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get transaction history'
      });
    }
  }

  // Admin: Get all settlements with pagination and filters
  async getAllSettlements(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const { 
        page = 1, 
        limit = 10, 
        status, 
        vendorName, 
        startDate, 
        endDate 
      } = req.query;

      let settlements = await database.getAllSettlements();
      

      // Apply filters
      if (status && status !== 'all') {
        settlements = settlements.filter(s => s.status === status);
      }

      if (vendorName) {
        settlements = settlements.filter(s => 
          s.vendorName.toLowerCase().includes(vendorName.toLowerCase())
        );
      }

      if (startDate) {
        settlements = settlements.filter(s => 
          new Date(s.createdAt) >= new Date(startDate)
        );
      }

      if (endDate) {
        settlements = settlements.filter(s => 
          new Date(s.createdAt) <= new Date(endDate)
        );
      }

      // Sort by creation date (newest first)
      settlements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Pagination
      const startIndex = (parseInt(page) - 1) * parseInt(limit);
      const endIndex = startIndex + parseInt(limit);
      const paginatedSettlements = settlements.slice(startIndex, endIndex);

      res.json({
        success: true,
        data: {
          settlements: paginatedSettlements,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(settlements.length / parseInt(limit)),
            totalItems: settlements.length,
            itemsPerPage: parseInt(limit)
          }
        }
      });
    } catch (error) {
      console.error('Error getting all settlements:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get settlements'
      });
    }
  }

  // Admin: Get settlement by ID
  async getSettlementById(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const { id } = req.params;
      const settlement = await database.getSettlementById(id);

      if (!settlement) {
        return res.status(404).json({
          success: false,
          message: 'Settlement not found'
        });
      }

      res.json({
        success: true,
        data: settlement
      });
    } catch (error) {
      console.error('Error getting settlement:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get settlement'
      });
    }
  }

  // Admin: Approve settlement request
  async approveSettlement(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { id } = req.params;
      const { amountPaid, transactionId } = req.body;
      const paymentProof = req.file;

      const settlement = await database.getSettlementById(id);
      if (!settlement) {
        return res.status(404).json({
          success: false,
          message: 'Settlement not found'
        });
      }

      if (settlement.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Settlement is not in pending status'
        });
      }

      const paidAmount = parseFloat(amountPaid);
      const requestedAmount = parseFloat(settlement.amount);

      if (paidAmount > requestedAmount) {
        return res.status(400).json({
          success: false,
          message: 'Amount paid cannot exceed requested amount'
        });
      }

      // Determine payment status
      const paymentStatus = paidAmount === requestedAmount ? 'settled_fully' : 'settled_partially';

      // Update settlement
      const updateData = {
        status: 'approved',
        paymentStatus,
        amountPaid: paidAmount,
        transactionId,
        paymentProofPath: paymentProof ? paymentProof.filename : null,
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
      };

      const updatedSettlement = await database.updateSettlement(id, updateData);

      // Create transaction record
      const transactionData = {
        vendor_id: settlement.vendorId,
        amount: paidAmount,
        type: 'settlement',
        description: `Settlement payment for settlement ${id}. Transaction ID: ${transactionId}${paymentProof ? `. Payment proof: ${paymentProof.filename}` : ''}`
      };

      const transaction = await database.createTransaction(transactionData);

      res.json({
        success: true,
        message: 'Settlement approved successfully',
        data: {
          settlement: updatedSettlement,
          transaction
        }
      });
    } catch (error) {
      console.error('Error approving settlement:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to approve settlement'
      });
    }
  }

  // Admin: Reject settlement request
  async rejectSettlement(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { id } = req.params;
      const { rejectionReason } = req.body;

      const settlement = await database.getSettlementById(id);
      if (!settlement) {
        return res.status(404).json({
          success: false,
          message: 'Settlement not found'
        });
      }

      if (settlement.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Settlement is not in pending status'
        });
      }

      // Update settlement
      const updateData = {
        status: 'rejected',
        rejectionReason,
        rejectedBy: req.user.id,
        rejectedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
      };

      const updatedSettlement = await database.updateSettlement(id, updateData);

      res.json({
        success: true,
        message: 'Settlement rejected successfully',
        data: updatedSettlement
      });
    } catch (error) {
      console.error('Error rejecting settlement:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reject settlement'
      });
    }
  }

  // Get payment proof file
  async getPaymentProof(req, res) {
    try {
      const { filename } = req.params;
      const filePath = path.join(__dirname, '../uploads/payment-proofs', filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: 'Payment proof not found'
        });
      }

      res.sendFile(filePath);
    } catch (error) {
      console.error('Error getting payment proof:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get payment proof'
      });
    }
  }

  // Export settlements as CSV
  async exportSettlementsCSV(req, res) {
    try {
      // Wait for MySQL initialization
      await database.waitForMySQLInitialization();
      
      if (!database.isMySQLAvailable()) {
        return res.status(500).json({
          success: false,
          message: 'Database connection not available'
        });
      }

      const settlements = await database.getAllSettlements();
      
      // Create CSV content
      const csvHeaders = [
        'Settlement ID',
        'Vendor Name', 
        'Amount (₹)',
        'Request Date',
        'Status',
        'Payment Status',
        'UPI ID',
        'Number of Orders',
        'Transaction ID',
        'Amount Paid (₹)',
        'Approved/Rejected Date',
        'Request Status'
      ];

      const csvRows = settlements.map(settlement => [
        settlement.id,
        settlement.vendorName,
        settlement.amount,
        new Date(settlement.createdAt).toLocaleDateString('en-IN'),
        settlement.status,
        settlement.paymentStatus || 'pending',
        settlement.upiId,
        settlement.numberOfOrders,
        settlement.transactionId || '',
        settlement.amountPaid || '',
        settlement.approvedAt ? new Date(settlement.approvedAt).toLocaleDateString('en-IN') : 
        settlement.rejectedAt ? new Date(settlement.rejectedAt).toLocaleDateString('en-IN') : '',
        settlement.status === 'pending' ? 'Under Review' : 
        settlement.status === 'approved' ? 'Accepted' : 'Rejected'
      ]);

      const csvContent = [csvHeaders, ...csvRows]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=settlements_${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csvContent);
    } catch (error) {
      console.error('Error exporting settlements:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export settlements'
      });
    }
  }
}

module.exports = { 
  SettlementController: new SettlementController(),
  upload
}; 