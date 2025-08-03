const express = require('express');
const { body, validationResult } = require('express-validator');
const blockchainService = require('../utils/blockchain');
const logger = require('../utils/logger');

const router = express.Router();

// @route   GET /api/wallet/balance
// @desc    Get user's wallet balances (USDT, aUSDT, and ToritoWallet data)
// @access  Private
router.get('/balance', async (req, res) => {
  try {
    const { walletAddress } = req.user;

    // Get balances from blockchain and ToritoWallet contract
    const [usdtBalance, aUsdtBalance, accountData, toritoUserAccount, contractStats] = await Promise.all([
      blockchainService.getUSDTBalance(walletAddress),
      blockchainService.getAUSDTBalance(walletAddress),
      blockchainService.getUserAccountData(walletAddress),
      blockchainService.getToritoUserAccount(walletAddress),
      blockchainService.getContractStats()
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
      },
      toritoWallet: {
        usdtBalance: parseFloat(toritoUserAccount.usdtBalance),
        bobDebt: parseFloat(toritoUserAccount.bobDebt),
        totalBobBorrowed: parseFloat(toritoUserAccount.totalBobBorrowed),
        totalBobRepaid: parseFloat(toritoUserAccount.totalBobRepaid),
        isActive: toritoUserAccount.isActive
      }
    };

    const stats = {
      contractTotalDeposits: parseFloat(contractStats.totalDeposits),
      contractTotalBobLoans: parseFloat(contractStats.totalBobLoans)
    };

    logger.info(`Balance retrieved for user ${req.user.email}: USDT=${usdtBalance}, aUSDT=${aUsdtBalance}, ToritoBalance=${toritoUserAccount.usdtBalance}`);

    res.json({
      success: true,
      data: {
        walletAddress,
        balances,
        contractStats: stats,
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
// @desc    Deposit USDT to ToritoWallet contract
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

    // Check user's USDT balance before deposit
    const usdtBalance = await blockchainService.getUSDTBalance(walletAddress);
    if (parseFloat(usdtBalance) < parseFloat(amount)) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient USDT balance'
      });
    }

    // Deposit USDT to ToritoWallet contract (which automatically supplies to Aave)
    const depositResult = await blockchainService.depositToToritoContract(amount, walletAddress);

    // Get updated user account data from contract
    const userAccount = await blockchainService.getToritoUserAccount(walletAddress);

    logger.info(`USDT deposit processed for user ${req.user.email}: ${amount} USDT`);

    res.json({
      success: true,
      data: {
        amount: parseFloat(amount),
        walletAddress,
        contractTransaction: {
          transactionHash: depositResult.transactionHash,
          blockNumber: depositResult.blockNumber,
          gasUsed: depositResult.gasUsed
        },
        userAccount: {
          usdtBalance: parseFloat(userAccount.usdtBalance),
          bobDebt: parseFloat(userAccount.bobDebt),
          totalBobBorrowed: parseFloat(userAccount.totalBobBorrowed),
          totalBobRepaid: parseFloat(userAccount.totalBobRepaid),
          isActive: userAccount.isActive
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Deposit error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Deposit failed';
    if (error.message.includes('insufficient funds')) {
      errorMessage = 'Insufficient funds for transaction';
    } else if (error.message.includes('ERC20: transfer amount exceeds balance')) {
      errorMessage = 'Insufficient USDT balance';
    } else if (error.message.includes('ERC20: transfer amount exceeds allowance')) {
      errorMessage = 'Token allowance insufficient';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/wallet/withdraw
// @desc    Withdraw USDT from ToritoWallet contract
// @access  Private
router.post('/withdraw', [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
  body('usdtToBobRate').isFloat({ min: 0.01 }).withMessage('USDT to BOB rate is required')
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

    const { amount, usdtToBobRate } = req.body;
    const { walletAddress } = req.user;

    // Get user's current balance in ToritoWallet contract
    const userAccount = await blockchainService.getToritoUserAccount(walletAddress);
    
    if (parseFloat(userAccount.usdtBalance) < parseFloat(amount)) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance in ToritoWallet contract'
      });
    }

    // If user has debt, check if withdrawal would leave insufficient collateral
    if (parseFloat(userAccount.bobDebt) > 0) {
      const requiredCollateral = await blockchainService.calculateRequiredCollateral(
        userAccount.bobDebt, 
        usdtToBobRate
      );
      const remainingBalance = parseFloat(userAccount.usdtBalance) - parseFloat(amount);
      
      if (remainingBalance < parseFloat(requiredCollateral)) {
        return res.status(400).json({
          success: false,
          error: 'Withdrawal would leave insufficient collateral for existing debt',
          details: {
            currentBalance: parseFloat(userAccount.usdtBalance),
            requestedWithdrawal: parseFloat(amount),
            remainingAfterWithdrawal: remainingBalance,
            requiredCollateral: parseFloat(requiredCollateral),
            currentDebt: parseFloat(userAccount.bobDebt)
          }
        });
      }
    }

    // Withdraw from ToritoWallet contract
    const withdrawResult = await blockchainService.withdrawFromToritoContract(
      amount, 
      usdtToBobRate, 
      walletAddress
    );

    // Get updated user account data
    const updatedUserAccount = await blockchainService.getToritoUserAccount(walletAddress);

    logger.info(`USDT withdrawal processed for user ${req.user.email}: ${amount} USDT`);

    res.json({
      success: true,
      data: {
        amount: parseFloat(amount),
        walletAddress,
        usdtToBobRate: parseFloat(usdtToBobRate),
        contractTransaction: {
          transactionHash: withdrawResult.transactionHash,
          blockNumber: withdrawResult.blockNumber,
          gasUsed: withdrawResult.gasUsed
        },
        userAccount: {
          usdtBalance: parseFloat(updatedUserAccount.usdtBalance),
          bobDebt: parseFloat(updatedUserAccount.bobDebt),
          totalBobBorrowed: parseFloat(updatedUserAccount.totalBobBorrowed),
          totalBobRepaid: parseFloat(updatedUserAccount.totalBobRepaid),
          isActive: updatedUserAccount.isActive
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Withdrawal error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Withdrawal failed';
    if (error.message.includes('Insufficient balance')) {
      errorMessage = 'Insufficient balance in contract';
    } else if (error.message.includes('Would leave insufficient collateral')) {
      errorMessage = 'Withdrawal would leave insufficient collateral';
    } else if (error.message.includes('insufficient funds')) {
      errorMessage = 'Insufficient gas for transaction';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
      case 'deposit':
        if (!amount) {
          return res.status(400).json({
            success: false,
            error: 'Amount required for deposit operation'
          });
        }
        gasEstimate = { gasLimit: '200000', gasPrice: '20000000000', estimatedCost: '0.004' };
        break;
      case 'withdraw':
        if (!amount) {
          return res.status(400).json({
            success: false,
            error: 'Amount required for withdraw operation'
          });
        }
        gasEstimate = { gasLimit: '150000', gasPrice: '20000000000', estimatedCost: '0.003' };
        break;
      case 'requestLoan':
        if (!amount) {
          return res.status(400).json({
            success: false,
            error: 'Amount required for loan request operation'
          });
        }
        gasEstimate = { gasLimit: '180000', gasPrice: '20000000000', estimatedCost: '0.0036' };
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid operation. Supported: deposit, withdraw, requestLoan'
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

// @route   POST /api/wallet/loan/request
// @desc    Request a BOB loan using USDT collateral
// @access  Private
router.post('/loan/request', [
  body('bobAmount').isFloat({ min: 0.01 }).withMessage('BOB amount must be at least 0.01'),
  body('usdtToBobRate').isFloat({ min: 0.01 }).withMessage('USDT to BOB rate is required')
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

    const { bobAmount, usdtToBobRate } = req.body;
    const { walletAddress } = req.user;

    // Get user's current account data
    const userAccount = await blockchainService.getToritoUserAccount(walletAddress);
    
    if (!userAccount.isActive) {
      return res.status(400).json({
        success: false,
        error: 'Account is not active. Please make a deposit first.'
      });
    }

    // Calculate required collateral and max borrowable
    const [requiredCollateral, maxBorrowable] = await Promise.all([
      blockchainService.calculateRequiredCollateral(bobAmount, usdtToBobRate),
      blockchainService.calculateMaxBorrowable(userAccount.usdtBalance, usdtToBobRate)
    ]);

    // Check if user has sufficient collateral
    if (parseFloat(userAccount.usdtBalance) < parseFloat(requiredCollateral)) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient collateral',
        details: {
          requestedBobAmount: parseFloat(bobAmount),
          requiredCollateral: parseFloat(requiredCollateral),
          currentBalance: parseFloat(userAccount.usdtBalance)
        }
      });
    }

    // Check if request exceeds borrowing capacity
    const newTotalDebt = parseFloat(userAccount.bobDebt) + parseFloat(bobAmount);
    if (newTotalDebt > parseFloat(maxBorrowable)) {
      return res.status(400).json({
        success: false,
        error: 'Loan request exceeds borrowing capacity',
        details: {
          requestedBobAmount: parseFloat(bobAmount),
          currentDebt: parseFloat(userAccount.bobDebt),
          newTotalDebt,
          maxBorrowable: parseFloat(maxBorrowable)
        }
      });
    }

    // Request loan from contract
    const loanResult = await blockchainService.requestLoanFromTorito(
      bobAmount,
      usdtToBobRate,
      walletAddress
    );

    // Get updated user account data
    const updatedUserAccount = await blockchainService.getToritoUserAccount(walletAddress);

    logger.info(`Loan requested for user ${req.user.email}: ${bobAmount} BOB, loanId: ${loanResult.loanId}`);

    res.json({
      success: true,
      data: {
        loanId: loanResult.loanId,
        bobAmount: parseFloat(bobAmount),
        usdtToBobRate: parseFloat(usdtToBobRate),
        requiredCollateral: parseFloat(requiredCollateral),
        walletAddress,
        contractTransaction: {
          transactionHash: loanResult.transactionHash,
          blockNumber: loanResult.blockNumber,
          gasUsed: loanResult.gasUsed
        },
        userAccount: {
          usdtBalance: parseFloat(updatedUserAccount.usdtBalance),
          bobDebt: parseFloat(updatedUserAccount.bobDebt),
          totalBobBorrowed: parseFloat(updatedUserAccount.totalBobBorrowed),
          totalBobRepaid: parseFloat(updatedUserAccount.totalBobRepaid),
          isActive: updatedUserAccount.isActive
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Loan request error:', error);
    
    let errorMessage = 'Loan request failed';
    if (error.message.includes('Insufficient collateral')) {
      errorMessage = 'Insufficient collateral for loan';
    } else if (error.message.includes('Exceeds borrowing capacity')) {
      errorMessage = 'Loan exceeds borrowing capacity';
    } else if (error.message.includes('Account not active')) {
      errorMessage = 'Account not active';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/wallet/loan/history
// @desc    Get user's loan history
// @access  Private
router.get('/loan/history', async (req, res) => {
  try {
    const { walletAddress } = req.user;

    // Get user's loan IDs
    const loanIds = await blockchainService.getUserLoanIds(walletAddress);

    logger.info(`Loan history retrieved for user ${req.user.email}: ${loanIds.length} loans`);

    res.json({
      success: true,
      data: {
        walletAddress,
        loanIds,
        totalLoans: loanIds.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Loan history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve loan history'
    });
  }
});

// @route   GET /api/wallet/borrowing-capacity
// @desc    Get user's borrowing capacity information
// @access  Private
router.get('/borrowing-capacity', async (req, res) => {
  try {
    const { usdtToBobRate } = req.query;
    const { walletAddress } = req.user;

    if (!usdtToBobRate) {
      return res.status(400).json({
        success: false,
        error: 'USDT to BOB rate is required'
      });
    }

    // Get user account data
    const userAccount = await blockchainService.getToritoUserAccount(walletAddress);
    
    // Calculate borrowing capacity
    const maxBorrowable = await blockchainService.calculateMaxBorrowable(
      userAccount.usdtBalance, 
      usdtToBobRate
    );

    const availableToBorrow = Math.max(0, parseFloat(maxBorrowable) - parseFloat(userAccount.bobDebt));

    logger.info(`Borrowing capacity retrieved for user ${req.user.email}`);

    res.json({
      success: true,
      data: {
        walletAddress,
        usdtToBobRate: parseFloat(usdtToBobRate),
        currentBalance: parseFloat(userAccount.usdtBalance),
        currentDebt: parseFloat(userAccount.bobDebt),
        maxBorrowable: parseFloat(maxBorrowable),
        availableToBorrow,
        utilizationRatio: parseFloat(maxBorrowable) > 0 ? 
          (parseFloat(userAccount.bobDebt) / parseFloat(maxBorrowable)) * 100 : 0,
        isActive: userAccount.isActive,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Borrowing capacity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate borrowing capacity'
    });
  }
});

module.exports = router;
