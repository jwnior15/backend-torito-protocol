const express = require('express');
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const ExchangeRate = require('../models/ExchangeRate');
const blockchainService = require('../utils/blockchain');
const logger = require('../utils/logger');

const router = express.Router();

// @route   GET /api/loans/quote
// @desc    Get loan quote based on aUSDT collateral and LTV ratio
// @access  Private
router.get('/quote', async (req, res) => {
  try {
    const { amount } = req.query;
    const { walletAddress } = req.user;

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid collateral amount required'
      });
    }

    const collateralAmount = parseFloat(amount);

    // Get user's aUSDT balance
    const aUsdtBalance = await blockchainService.getAUSDTBalance(walletAddress);
    if (parseFloat(aUsdtBalance) < collateralAmount) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient aUSDT balance'
      });
    }

    // Get latest exchange rate
    const exchangeRate = await ExchangeRate.getLatestRate('USDT', 'BOB');
    if (!exchangeRate) {
      return res.status(503).json({
        success: false,
        error: 'Exchange rate not available'
      });
    }

    // Calculate loan parameters
    const ltvRatio = parseFloat(process.env.DEFAULT_LTV_RATIO) || 0.75;
    const maxLoanUSD = collateralAmount * ltvRatio;
    const maxLoanBOB = maxLoanUSD * exchangeRate.rate;

    // Check loan limits
    const minLoanBOB = parseFloat(process.env.MIN_LOAN_AMOUNT_BOB) || 100;
    const maxLoanBOBLimit = parseFloat(process.env.MAX_LOAN_AMOUNT_BOB) || 50000;

    const quote = {
      collateral: {
        amount: collateralAmount,
        token: 'aUSDT',
        usdValue: collateralAmount
      },
      loan: {
        maxAmountUSD: maxLoanUSD,
        maxAmountBOB: Math.min(maxLoanBOB, maxLoanBOBLimit),
        minAmountBOB: minLoanBOB,
        ltvRatio: ltvRatio * 100, // Convert to percentage
        exchangeRate: exchangeRate.rate
      },
      limits: {
        minLoanBOB,
        maxLoanBOB: maxLoanBOBLimit
      },
      fees: {
        originationFee: 0, // Could add fees here
        interestRate: 0 // This is a simple loan without interest for demo
      },
      exchangeRateInfo: {
        rate: exchangeRate.rate,
        source: exchangeRate.source,
        lastUpdated: exchangeRate.createdAt
      }
    };

    logger.info(`Loan quote generated for user ${req.user.email}: ${collateralAmount} aUSDT -> ${maxLoanBOB} BOB`);

    res.json({
      success: true,
      data: quote
    });
  } catch (error) {
    logger.error('Loan quote error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate loan quote'
    });
  }
});

// @route   POST /api/loans/request
// @desc    Create a new loan request
// @access  Private
router.post('/request', [
  body('collateralAmount').isFloat({ min: 0.01 }),
  body('loanAmountBOB').isFloat({ min: 1 }),
  body('bankAccount.accountNumber').notEmpty(),
  body('bankAccount.bankName').notEmpty(),
  body('bankAccount.accountHolder').notEmpty()
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

    const { collateralAmount, loanAmountBOB, bankAccount } = req.body;
    const { walletAddress } = req.user;

    // Verify user has sufficient aUSDT balance
    const aUsdtBalance = await blockchainService.getAUSDTBalance(walletAddress);
    if (parseFloat(aUsdtBalance) < collateralAmount) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient aUSDT balance'
      });
    }

    // Get current exchange rate
    const exchangeRate = await ExchangeRate.getLatestRate('USDT', 'BOB');
    if (!exchangeRate) {
      return res.status(503).json({
        success: false,
        error: 'Exchange rate not available'
      });
    }

    // Validate loan parameters
    const ltvRatio = parseFloat(process.env.DEFAULT_LTV_RATIO) || 0.75;
    const maxLoanUSD = collateralAmount * ltvRatio;
    const maxLoanBOB = maxLoanUSD * exchangeRate.rate;
    const loanAmountUSD = loanAmountBOB / exchangeRate.rate;

    if (loanAmountBOB > maxLoanBOB) {
      return res.status(400).json({
        success: false,
        error: `Loan amount exceeds maximum allowed: ${maxLoanBOB.toFixed(2)} BOB`
      });
    }

    const minLoanBOB = parseFloat(process.env.MIN_LOAN_AMOUNT_BOB) || 100;
    if (loanAmountBOB < minLoanBOB) {
      return res.status(400).json({
        success: false,
        error: `Loan amount below minimum: ${minLoanBOB} BOB`
      });
    }

    // Create loan record
    const loan = new Loan({
      userId: req.user._id,
      collateral: {
        amount: collateralAmount,
        token: 'aUSDT',
        usdValue: collateralAmount
      },
      loan: {
        amountBOB: loanAmountBOB,
        amountUSD: loanAmountUSD,
        exchangeRate: exchangeRate.rate,
        ltvRatio
      },
      partner: {
        bankDetails: bankAccount
      },
      repayment: {
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      }
    });

    await loan.save();

    // TODO: Send request to partner API
    // This would typically involve calling the partner's API to initiate the bank transfer
    
    logger.info(`Loan request created: ${loan.loanId} for user ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: {
        loanId: loan.loanId,
        status: loan.status,
        collateral: loan.collateral,
        loan: loan.loan,
        bankDetails: loan.partner.bankDetails,
        repayment: {
          dueDate: loan.repayment.dueDate
        },
        createdAt: loan.createdAt
      }
    });
  } catch (error) {
    logger.error('Loan request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create loan request'
    });
  }
});

// @route   GET /api/loans
// @desc    Get user's loans
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { userId: req.user._id };
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const loans = await Loan.find(query)
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await Loan.countDocuments(query);

    res.json({
      success: true,
      data: {
        loans,
        pagination: {
          page: options.page,
          limit: options.limit,
          total,
          pages: Math.ceil(total / options.limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get loans error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve loans'
    });
  }
});

// @route   GET /api/loans/:loanId
// @desc    Get specific loan details
// @access  Private
router.get('/:loanId', async (req, res) => {
  try {
    const { loanId } = req.params;

    const loan = await Loan.findOne({
      loanId,
      userId: req.user._id
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan not found'
      });
    }

    res.json({
      success: true,
      data: loan
    });
  } catch (error) {
    logger.error('Get loan error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve loan'
    });
  }
});

// @route   GET /api/loans/summary/debt
// @desc    Get user's debt summary
// @access  Private
router.get('/summary/debt', async (req, res) => {
  try {
    const userId = req.user._id;

    // Aggregate loan data
    const summary = await Loan.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmountBOB: { $sum: '$loan.amountBOB' },
          totalAmountUSD: { $sum: '$loan.amountUSD' },
          totalCollateral: { $sum: '$collateral.amount' }
        }
      }
    ]);

    // Calculate totals
    let totalActiveLoans = 0;
    let totalDebtBOB = 0;
    let totalDebtUSD = 0;
    let totalCollateralLocked = 0;

    const statusBreakdown = {};

    summary.forEach(item => {
      statusBreakdown[item._id] = {
        count: item.count,
        totalAmountBOB: item.totalAmountBOB,
        totalAmountUSD: item.totalAmountUSD,
        totalCollateral: item.totalCollateral
      };

      if (['pending', 'approved', 'funded'].includes(item._id)) {
        totalActiveLoans += item.count;
        totalDebtBOB += item.totalAmountBOB;
        totalDebtUSD += item.totalAmountUSD;
        totalCollateralLocked += item.totalCollateral;
      }
    });

    // Get current aUSDT balance
    const aUsdtBalance = await blockchainService.getAUSDTBalance(req.user.walletAddress);

    res.json({
      success: true,
      data: {
        summary: {
          totalActiveLoans,
          totalDebtBOB,
          totalDebtUSD,
          totalCollateralLocked,
          availableCollateral: parseFloat(aUsdtBalance) - totalCollateralLocked
        },
        statusBreakdown,
        walletAddress: req.user.walletAddress,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Debt summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve debt summary'
    });
  }
});

// @route   PUT /api/loans/:loanId/cancel
// @desc    Cancel a pending loan
// @access  Private
router.put('/:loanId/cancel', async (req, res) => {
  try {
    const { loanId } = req.params;

    const loan = await Loan.findOne({
      loanId,
      userId: req.user._id,
      status: 'pending'
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Pending loan not found'
      });
    }

    loan.status = 'cancelled';
    await loan.save();

    logger.info(`Loan cancelled: ${loanId} by user ${req.user.email}`);

    res.json({
      success: true,
      data: {
        loanId: loan.loanId,
        status: loan.status,
        updatedAt: loan.updatedAt
      }
    });
  } catch (error) {
    logger.error('Cancel loan error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel loan'
    });
  }
});

module.exports = router;
