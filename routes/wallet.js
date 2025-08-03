const express = require('express');
const { body, validationResult } = require('express-validator');
const blockchainService = require('../utils/blockchain');
const logger = require('../utils/logger');

const router = express.Router();

// @route   GET /api/wallet/balance
// @desc    Get user's wallet balances (USDT and aUSDT)
// @access  Private
router.get('/balance', async (req, res) => {
  try {
    const { walletAddress } = req.user;

    // Get balances from blockchain
    const [usdtBalance, aUsdtBalance, accountData] = await Promise.all([
      blockchainService.getUSDTBalance(walletAddress),
      blockchainService.getAUSDTBalance(walletAddress),
      blockchainService.getUserAccountData(walletAddress)
    ]);

    const balances = {
      usdt: {
        balance: parseFloat(usdtBalance),
        symbol: 'USDT',
        decimals: 6
      },
      aUsdt: {
        balance: parseFloat(aUsdtBalance),
        symbol: 'aUSDT',
        decimals: 6
      },
      aave: {
        totalCollateralETH: parseFloat(accountData.totalCollateralETH),
        totalDebtETH: parseFloat(accountData.totalDebtETH),
        availableBorrowsETH: parseFloat(accountData.availableBorrowsETH),
        healthFactor: parseFloat(accountData.healthFactor),
        ltv: parseInt(accountData.ltv) / 100 // Convert to percentage
      }
    };

    logger.info(`Balance retrieved for user ${req.user.email}: USDT=${usdtBalance}, aUSDT=${aUsdtBalance}`);

    res.json({
      success: true,
      data: {
        walletAddress,
        balances,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Balance retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve balance'
    });
  }
});

// @route   POST /api/wallet/deposit
// @desc    Track USDT deposit and supply to Aave
// @access  Private
router.post('/deposit', [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
  body('transactionHash').optional().isLength({ min: 66, max: 66 })
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

    const { amount, transactionHash } = req.body;
    const { walletAddress } = req.user;

    // If transaction hash is provided, verify it
    if (transactionHash) {
      const txStatus = await blockchainService.getTransactionStatus(transactionHash);
      if (txStatus.status !== 'confirmed') {
        return res.status(400).json({
          success: false,
          error: 'Transaction not confirmed yet'
        });
      }
    }

    // Supply USDT to Aave to get aUSDT
    const supplyResult = await blockchainService.supplyToAave(amount, walletAddress);

    logger.info(`USDT deposit processed for user ${req.user.email}: ${amount} USDT`);

    res.json({
      success: true,
      data: {
        amount: parseFloat(amount),
        walletAddress,
        aaveTransaction: {
          transactionHash: supplyResult.transactionHash,
          blockNumber: supplyResult.blockNumber,
          gasUsed: supplyResult.gasUsed
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Deposit error:', error);
    res.status(500).json({
      success: false,
      error: 'Deposit failed'
    });
  }
});

// @route   POST /api/wallet/withdraw
// @desc    Withdraw USDT from Aave
// @access  Private
router.post('/withdraw', [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01')
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

    const { amount } = req.body;
    const { walletAddress } = req.user;

    // Check if user has sufficient aUSDT balance
    const aUsdtBalance = await blockchainService.getAUSDTBalance(walletAddress);
    if (parseFloat(aUsdtBalance) < parseFloat(amount)) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient aUSDT balance'
      });
    }

    // Withdraw from Aave
    const withdrawResult = await blockchainService.withdrawFromAave(amount, walletAddress);

    logger.info(`USDT withdrawal processed for user ${req.user.email}: ${amount} USDT`);

    res.json({
      success: true,
      data: {
        amount: parseFloat(amount),
        walletAddress,
        aaveTransaction: {
          transactionHash: withdrawResult.transactionHash,
          blockNumber: withdrawResult.blockNumber,
          gasUsed: withdrawResult.gasUsed
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Withdrawal error:', error);
    res.status(500).json({
      success: false,
      error: 'Withdrawal failed'
    });
  }
});

// @route   GET /api/wallet/transaction/:hash
// @desc    Get transaction status
// @access  Private
router.get('/transaction/:hash', async (req, res) => {
  try {
    const { hash } = req.params;

    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid transaction hash format'
      });
    }

    const txStatus = await blockchainService.getTransactionStatus(hash);

    res.json({
      success: true,
      data: {
        transactionHash: hash,
        ...txStatus,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Transaction status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get transaction status'
    });
  }
});

// @route   GET /api/wallet/gas-estimate
// @desc    Get gas estimates for common operations
// @access  Private
router.get('/gas-estimate', async (req, res) => {
  try {
    const { operation, amount } = req.query;
    const { walletAddress } = req.user;

    let gasEstimate;

    switch (operation) {
      case 'supply':
        if (!amount) {
          return res.status(400).json({
            success: false,
            error: 'Amount required for supply operation'
          });
        }
        // This would need to be implemented based on your contract methods
        gasEstimate = { gasLimit: '150000', gasPrice: '20000000000', estimatedCost: '0.003' };
        break;
      case 'withdraw':
        if (!amount) {
          return res.status(400).json({
            success: false,
            error: 'Amount required for withdraw operation'
          });
        }
        gasEstimate = { gasLimit: '120000', gasPrice: '20000000000', estimatedCost: '0.0024' };
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid operation. Supported: supply, withdraw'
        });
    }

    res.json({
      success: true,
      data: {
        operation,
        amount: amount ? parseFloat(amount) : null,
        gasEstimate,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Gas estimate error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to estimate gas'
    });
  }
});

module.exports = router;
