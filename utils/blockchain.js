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

    // ABI definitions (simplified for demo)
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
      ]
    };

    this.contracts = {
      usdt: new ethers.Contract(this.addresses.usdt, this.abis.erc20, this.wallet),
      aUsdt: new ethers.Contract(this.addresses.aUsdt, this.abis.erc20, this.wallet),
      aavePool: new ethers.Contract(this.addresses.aavePool, this.abis.aavePool, this.wallet)
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
}

module.exports = new BlockchainService();
