const express = require('express');
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const logger = require('../utils/logger');

const router = express.Router();

// Middleware to verify partner API key
const verifyPartnerAuth = (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  
  if (!apiKey || apiKey !== process.env.PARTNER_API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing API key'
    });
  }
  
  next();
};

// @route   POST /api/partner/loan/status
// @desc    Update loan status from partner
// @access  Partner API
router.post('/loan/status', verifyPartnerAuth, [
  body('loanId').notEmpty(),
  body('status').isIn(['approved', 'funded', 'rejected']),
  body('partnerOrderId').optional(),
  body('transferId').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { loanId, status, partnerOrderId, transferId, notes } = req.body;

    const loan = await Loan.findOne({ loanId });
    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan not found'
      });
    }

    // Update loan status
    loan.status = status;
    
    if (partnerOrderId) {
      loan.partner.orderId = partnerOrderId;
    }
    
    if (transferId) {
      loan.partner.transferId = transferId;
    }

    await loan.save();

    logger.info(`Loan status updated by partner: ${loanId} -> ${status}`);

    res.json({
      success: true,
      data: {
        loanId: loan.loanId,
        status: loan.status,
        updatedAt: loan.updatedAt
      }
    });
  } catch (error) {
    logger.error('Partner loan status update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update loan status'
    });
  }
});

// @route   POST /api/partner/loan/repayment
// @desc    Confirm loan repayment from partner
// @access  Partner API
router.post('/loan/repayment', verifyPartnerAuth, [
  body('loanId').notEmpty(),
  body('repaidAmount').isFloat({ min: 0 }),
  body('confirmationId').notEmpty(),
  body('repaymentDate').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { 
      loanId, 
      repaidAmount, 
      confirmationId, 
      repaymentDate,
      notes 
    } = req.body;

    const loan = await Loan.findOne({ loanId });
    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan not found'
      });
    }

    // Verify loan is in a state that can be repaid
    if (!['funded', 'approved'].includes(loan.status)) {
      return res.status(400).json({
        success: false,
        error: 'Loan is not in a repayable state'
      });
    }

    // Update repayment information
    loan.status = 'repaid';
    loan.repayment.repaidAt = repaymentDate ? new Date(repaymentDate) : new Date();
    loan.repayment.repaidAmount = repaidAmount;
    loan.repayment.partnerConfirmation.confirmed = true;
    loan.repayment.partnerConfirmation.confirmedAt = new Date();
    loan.repayment.partnerConfirmation.confirmationId = confirmationId;

    await loan.save();

    logger.info(`Loan repayment confirmed by partner: ${loanId} - ${repaidAmount} BOB`);

    res.json({
      success: true,
      data: {
        loanId: loan.loanId,
        status: loan.status,
        repayment: {
          repaidAmount: loan.repayment.repaidAmount,
          repaidAt: loan.repayment.repaidAt,
          confirmationId: loan.repayment.partnerConfirmation.confirmationId
        },
        updatedAt: loan.updatedAt
      }
    });
  } catch (error) {
    logger.error('Partner repayment confirmation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm repayment'
    });
  }
});

// @route   POST /api/partner/loan/transfer
// @desc    Notify successful bank transfer
// @access  Partner API
router.post('/loan/transfer', verifyPartnerAuth, [
  body('loanId').notEmpty(),
  body('transferId').notEmpty(),
  body('transferAmount').isFloat({ min: 0 }),
  body('transferDate').optional().isISO8601(),
  body('bankDetails.accountNumber').notEmpty(),
  body('bankDetails.bankName').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { 
      loanId, 
      transferId, 
      transferAmount, 
      transferDate,
      bankDetails,
      notes 
    } = req.body;

    const loan = await Loan.findOne({ loanId });
    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan not found'
      });
    }

    // Update loan with transfer information
    loan.status = 'funded';
    loan.partner.transferId = transferId;
    loan.partner.bankDetails = {
      ...loan.partner.bankDetails,
      ...bankDetails
    };

    await loan.save();

    logger.info(`Bank transfer confirmed by partner: ${loanId} - ${transferAmount} BOB to ${bankDetails.accountNumber}`);

    res.json({
      success: true,
      data: {
        loanId: loan.loanId,
        status: loan.status,
        transfer: {
          transferId,
          transferAmount,
          transferDate: transferDate || new Date().toISOString(),
          bankDetails
        },
        updatedAt: loan.updatedAt
      }
    });
  } catch (error) {
    logger.error('Partner transfer notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process transfer notification'
    });
  }
});

// @route   GET /api/partner/loans/pending
// @desc    Get pending loans for partner processing
// @access  Partner API
router.get('/loans/pending', verifyPartnerAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const loans = await Loan.find({ 
      status: 'pending' 
    })
    .populate('userId', 'email profile.firstName profile.lastName')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Loan.countDocuments({ status: 'pending' });

    // Format loans for partner consumption
    const formattedLoans = loans.map(loan => ({
      loanId: loan.loanId,
      user: {
        email: loan.userId.email,
        name: `${loan.userId.profile.firstName} ${loan.userId.profile.lastName}`.trim()
      },
      loan: {
        amountBOB: loan.loan.amountBOB,
        amountUSD: loan.loan.amountUSD,
        exchangeRate: loan.loan.exchangeRate
      },
      bankDetails: loan.partner.bankDetails,
      collateral: loan.collateral,
      createdAt: loan.createdAt,
      dueDate: loan.repayment.dueDate
    }));

    res.json({
      success: true,
      data: {
        loans: formattedLoans,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    logger.error('Get pending loans error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve pending loans'
    });
  }
});

// @route   POST /api/partner/webhook/test
// @desc    Test webhook endpoint
// @access  Partner API
router.post('/webhook/test', verifyPartnerAuth, (req, res) => {
  logger.info('Partner webhook test received:', req.body);
  
  res.json({
    success: true,
    message: 'Webhook test successful',
    timestamp: new Date().toISOString(),
    receivedData: req.body
  });
});

// @route   GET /api/partner/health
// @desc    Partner API health check
// @access  Partner API
router.get('/health', verifyPartnerAuth, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

module.exports = router;
