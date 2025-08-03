const { ethers } = require('ethers');
const logger = require('./logger');

class BlockchainService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
    
    // Contract addresses
    this.addresses = {
      aavePool: process.env.AAVE_POOL_ADDRESS,
      usdt: process.env.USDT_ADDRESS,
      aUsdt: process.env.AUSDT_ADDRESS,
      smartContract: process.env.SMART_CONTRACT_ADDRESS
    };

    // ABI definitions
    this.abis = {
      erc20: [
        'function balanceOf(address owner) view returns (uint256)',
        'function transfer(address to, uint256 amount) returns (bool)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function decimals() view returns (uint8)'
      ],
      aavePool: [
        'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
        'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
        'function getUserAccountData(address user) view returns (uint256, uint256, uint256, uint256, uint256, uint256)'
      ],
      toritoWallet: [
        {
          "inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}],
          "name": "deposit",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
            {"internalType": "uint256", "name": "usdtToBobRate", "type": "uint256"}
          ],
          "name": "withdraw",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {"internalType": "uint256", "name": "bobAmount", "type": "uint256"},
            {"internalType": "uint256", "name": "usdtToBobRate", "type": "uint256"}
          ],
          "name": "requestLoan",
          "outputs": [{"internalType": "uint256", "name": "loanId", "type": "uint256"}],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
          "name": "getUserAccount",
          "outputs": [{
            "components": [
              {"internalType": "uint256", "name": "usdtBalance", "type": "uint256"},
              {"internalType": "uint256", "name": "bobDebt", "type": "uint256"},
              {"internalType": "uint256", "name": "totalBobBorrowed", "type": "uint256"},
              {"internalType": "uint256", "name": "totalBobRepaid", "type": "uint256"},
              {"internalType": "bool", "name": "isActive", "type": "bool"}
            ],
            "internalType": "struct ToritoWallet.UserAccount",
            "name": "",
            "type": "tuple"
          }],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {"internalType": "uint256", "name": "usdtBalance", "type": "uint256"},
            {"internalType": "uint256", "name": "usdtToBobRate", "type": "uint256"}
          ],
          "name": "calculateMaxBorrowable",
          "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
          "stateMutability": "pure",
          "type": "function"
        },
        {
          "inputs": [
            {"internalType": "uint256", "name": "bobAmount", "type": "uint256"},
            {"internalType": "uint256", "name": "usdtToBobRate", "type": "uint256"}
          ],
          "name": "calculateRequiredCollateral",
          "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
          "stateMutability": "pure",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "getContractStats",
          "outputs": [
            {"internalType": "uint256", "name": "", "type": "uint256"},
            {"internalType": "uint256", "name": "", "type": "uint256"}
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
          "name": "getUserLoanIds",
          "outputs": [{"internalType": "uint256[]", "name": "", "type": "uint256[]"}],
          "stateMutability": "view",
          "type": "function"
        }
      ]
    };

    this.contracts = {
      usdt: new ethers.Contract(this.addresses.usdt, this.abis.erc20, this.wallet),
      aUsdt: new ethers.Contract(this.addresses.aUsdt, this.abis.erc20, this.wallet),
      aavePool: new ethers.Contract(this.addresses.aavePool, this.abis.aavePool, this.wallet),
      toritoWallet: new ethers.Contract(this.addresses.smartContract, this.abis.toritoWallet, this.wallet)
    };
  }

  async getUSDTBalance(address) {
    try {
      const balance = await this.contracts.usdt.balanceOf(address);
      const decimals = await this.contracts.usdt.decimals();
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      logger.error('Error getting USDT balance:', error);
      throw error;
    }
  }

  async getAUSDTBalance(address) {
    try {
      const balance = await this.contracts.aUsdt.balanceOf(address);
      const decimals = await this.contracts.aUsdt.decimals();
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      logger.error('Error getting aUSDT balance:', error);
      throw error;
    }
  }

  async getUserAccountData(address) {
    try {
      const accountData = await this.contracts.aavePool.getUserAccountData(address);
      return {
        totalCollateralETH: ethers.formatEther(accountData[0]),
        totalDebtETH: ethers.formatEther(accountData[1]),
        availableBorrowsETH: ethers.formatEther(accountData[2]),
        currentLiquidationThreshold: accountData[3].toString(),
        ltv: accountData[4].toString(),
        healthFactor: ethers.formatEther(accountData[5])
      };
    } catch (error) {
      logger.error('Error getting user account data:', error);
      throw error;
    }
  }

  async supplyToAave(amount, userAddress) {
    try {
      const amountWei = ethers.parseUnits(amount.toString(), 6); // USDT has 6 decimals
      
      // First approve the Aave pool to spend USDT
      const approveTx = await this.contracts.usdt.approve(this.addresses.aavePool, amountWei);
      await approveTx.wait();
      
      // Supply to Aave
      const supplyTx = await this.contracts.aavePool.supply(
        this.addresses.usdt,
        amountWei,
        userAddress,
        0 // referral code
      );
      
      const receipt = await supplyTx.wait();
      
      logger.info(`USDT supplied to Aave: ${amount} USDT for user ${userAddress}`);
      
      return {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error('Error supplying to Aave:', error);
      throw error;
    }
  }

  async withdrawFromAave(amount, userAddress) {
    try {
      const amountWei = ethers.parseUnits(amount.toString(), 6);
      
      const withdrawTx = await this.contracts.aavePool.withdraw(
        this.addresses.usdt,
        amountWei,
        userAddress
      );
      
      const receipt = await withdrawTx.wait();
      
      logger.info(`USDT withdrawn from Aave: ${amount} USDT for user ${userAddress}`);
      
      return {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error('Error withdrawing from Aave:', error);
      throw error;
    }
  }

  async getTransactionStatus(txHash) {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { status: 'pending' };
      }
      
      return {
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        confirmations: await receipt.confirmations()
      };
    } catch (error) {
      logger.error('Error getting transaction status:', error);
      throw error;
    }
  }

  async estimateGas(method, params) {
    try {
      const gasEstimate = await method.estimateGas(...params);
      const gasPrice = await this.provider.getFeeData();
      
      return {
        gasLimit: gasEstimate.toString(),
        gasPrice: gasPrice.gasPrice.toString(),
        estimatedCost: ethers.formatEther(gasEstimate * gasPrice.gasPrice)
      };
    } catch (error) {
      logger.error('Error estimating gas:', error);
      throw error;
    }
  }

  // ToritoWallet contract methods
  async depositToToritoContract(amount, userAddress) {
    try {
      const amountWei = ethers.parseUnits(amount.toString(), 6); // USDT has 6 decimals
      
      // First approve the ToritoWallet contract to spend USDT
      const approveTx = await this.contracts.usdt.approve(this.addresses.smartContract, amountWei);
      await approveTx.wait();
      
      logger.info(`USDT approved for ToritoWallet contract: ${amount} USDT`);
      
      // Call deposit function on ToritoWallet contract
      const depositTx = await this.contracts.toritoWallet.deposit(amountWei);
      const receipt = await depositTx.wait();
      
      logger.info(`USDT deposited to ToritoWallet: ${amount} USDT for user ${userAddress}`);
      
      return {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error('Error depositing to ToritoWallet:', error);
      throw error;
    }
  }

  async withdrawFromToritoContract(amount, usdtToBobRate, userAddress) {
    try {
      const amountWei = ethers.parseUnits(amount.toString(), 6);
      const rateWei = ethers.parseUnits(usdtToBobRate.toString(), 8); // Rate has 8 decimals
      
      const withdrawTx = await this.contracts.toritoWallet.withdraw(amountWei, rateWei);
      const receipt = await withdrawTx.wait();
      
      logger.info(`USDT withdrawn from ToritoWallet: ${amount} USDT for user ${userAddress}`);
      
      return {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error('Error withdrawing from ToritoWallet:', error);
      throw error;
    }
  }

  async getToritoUserAccount(userAddress) {
    try {
      const account = await this.contracts.toritoWallet.getUserAccount(userAddress);
      
      return {
        usdtBalance: ethers.formatUnits(account.usdtBalance, 6),
        bobDebt: ethers.formatUnits(account.bobDebt, 2), // BOB has 2 decimals
        totalBobBorrowed: ethers.formatUnits(account.totalBobBorrowed, 2),
        totalBobRepaid: ethers.formatUnits(account.totalBobRepaid, 2),
        isActive: account.isActive
      };
    } catch (error) {
      logger.error('Error getting ToritoWallet user account:', error);
      throw error;
    }
  }

  async requestLoanFromTorito(bobAmount, usdtToBobRate, userAddress) {
    try {
      const bobAmountWei = ethers.parseUnits(bobAmount.toString(), 2); // BOB has 2 decimals
      const rateWei = ethers.parseUnits(usdtToBobRate.toString(), 8); // Rate has 8 decimals
      
      const loanTx = await this.contracts.toritoWallet.requestLoan(bobAmountWei, rateWei);
      const receipt = await loanTx.wait();
      
      // Extract loan ID from transaction receipt
      const loanRequestedEvent = receipt.logs.find(log => {
        try {
          const parsedLog = this.contracts.toritoWallet.interface.parseLog(log);
          return parsedLog.name === 'LoanRequested';
        } catch {
          return false;
        }
      });
      
      let loanId = null;
      if (loanRequestedEvent) {
        const parsedLog = this.contracts.toritoWallet.interface.parseLog(loanRequestedEvent);
        loanId = parsedLog.args.loanId.toString();
      }
      
      logger.info(`Loan requested from ToritoWallet: ${bobAmount} BOB for user ${userAddress}, loanId: ${loanId}`);
      
      return {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        loanId
      };
    } catch (error) {
      logger.error('Error requesting loan from ToritoWallet:', error);
      throw error;
    }
  }

  async getUserLoanIds(userAddress) {
    try {
      const loanIds = await this.contracts.toritoWallet.getUserLoanIds(userAddress);
      return loanIds.map(id => id.toString());
    } catch (error) {
      logger.error('Error getting user loan IDs:', error);
      throw error;
    }
  }

  async calculateMaxBorrowable(usdtBalance, usdtToBobRate) {
    try {
      const balanceWei = ethers.parseUnits(usdtBalance.toString(), 6);
      const rateWei = ethers.parseUnits(usdtToBobRate.toString(), 8);
      
      const maxBorrowable = await this.contracts.toritoWallet.calculateMaxBorrowable(balanceWei, rateWei);
      return ethers.formatUnits(maxBorrowable, 2); // BOB has 2 decimals
    } catch (error) {
      logger.error('Error calculating max borrowable:', error);
      throw error;
    }
  }

  async calculateRequiredCollateral(bobAmount, usdtToBobRate) {
    try {
      const bobAmountWei = ethers.parseUnits(bobAmount.toString(), 2);
      const rateWei = ethers.parseUnits(usdtToBobRate.toString(), 8);
      
      const requiredCollateral = await this.contracts.toritoWallet.calculateRequiredCollateral(bobAmountWei, rateWei);
      return ethers.formatUnits(requiredCollateral, 6); // USDT has 6 decimals
    } catch (error) {
      logger.error('Error calculating required collateral:', error);
      throw error;
    }
  }

  async getContractStats() {
    try {
      const stats = await this.contracts.toritoWallet.getContractStats();
      return {
        totalDeposits: ethers.formatUnits(stats[0], 6),
        totalBobLoans: ethers.formatUnits(stats[1], 2)
      };
    } catch (error) {
      logger.error('Error getting contract stats:', error);
      throw error;
    }
  }
}

module.exports = new BlockchainService();
