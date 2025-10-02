const express = require('express');
const router = express.Router();
const { SettlementController, upload } = require('../controllers/settlementController');
const { authenticateToken, requireVendor, requireAdminOrSuperadmin } = require('../middleware/auth');
const { body, param } = require('express-validator');

// Validation middleware
const validateSettlementRequest = [
  body('upiId')
    .notEmpty()
    .withMessage('UPI ID is required')
    .isLength({ min: 3, max: 100 })
    .withMessage('UPI ID must be between 3 and 100 characters')
];

const validateSettlementApproval = [
  param('id')
    .notEmpty()
    .withMessage('Settlement ID is required'),
  body('amountPaid')
    .isFloat({ min: 0.01 })
    .withMessage('Amount paid must be a positive number'),
  body('transactionId')
    .notEmpty()
    .withMessage('Transaction ID is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Transaction ID must be between 1 and 100 characters')
];

const validateSettlementRejection = [
  param('id')
    .notEmpty()
    .withMessage('Settlement ID is required'),
  body('rejectionReason')
    .notEmpty()
    .withMessage('Rejection reason is required')
    .isLength({ min: 10, max: 500 })
    .withMessage('Rejection reason must be between 10 and 500 characters')
];

// Vendor routes
router.get('/vendor/payments', authenticateToken, requireVendor, SettlementController.getVendorPayments);
router.post('/vendor/request', authenticateToken, requireVendor, validateSettlementRequest, SettlementController.createSettlementRequest);
router.get('/vendor/history', authenticateToken, requireVendor, SettlementController.getVendorSettlements);
router.get('/vendor/transactions', authenticateToken, requireVendor, SettlementController.getVendorTransactions);

// Admin routes
router.get('/admin/all', authenticateToken, requireAdminOrSuperadmin, SettlementController.getAllSettlements);
router.get('/admin/export-csv', authenticateToken, requireAdminOrSuperadmin, SettlementController.exportSettlementsCSV);
router.get('/admin/:id', authenticateToken, requireAdminOrSuperadmin, SettlementController.getSettlementById);
router.post('/admin/:id/approve', authenticateToken, requireAdminOrSuperadmin, upload.single('paymentProof'), validateSettlementApproval, SettlementController.approveSettlement);
router.post('/admin/:id/reject', authenticateToken, requireAdminOrSuperadmin, validateSettlementRejection, SettlementController.rejectSettlement);

// File access routes
router.get('/proof/:filename', authenticateToken, SettlementController.getPaymentProof);

module.exports = router; 