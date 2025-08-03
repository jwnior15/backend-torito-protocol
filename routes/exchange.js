const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const ExchangeRate = require('../models/ExchangeRate');
const logger = require('../utils/logger');

const router = express.Router();

// Exchange rate service
class ExchangeRateService {
  constructor() {
    this.apiUrl = process.env.EXCHANGE_RATE_API_URL;
    this.apiKey = process.env.EXCHANGE_RATE_API_KEY;
  }

  async fetchUSDToBOBRate() {
    try {
      // First get USD to BOB rate from external API
      const response = await axios.get(`${this.apiUrl}`, {
        params: {
          access_key: this.apiKey
        },
        timeout: 10000
      });

      if (!response.data || !response.data.rates || !response.data.rates.BOB) {
        throw new Error('Invalid API response format');
      }

      // Since USDT is pegged to USD, we can use USD rate
      const usdToBobRate = response.data.rates.BOB;
      
      return {
        rate: usdToBobRate,
        source: 'api',
        metadata: {
          apiProvider: 'exchangerate-api',
          confidence: 0.95,
          spread: 0.001
        }
      };
    } catch (error) {
      logger.error('Error fetching exchange rate from API:', error);
      
      // Fallback to a default rate or throw error
      throw new Error('Failed to fetch exchange rate from external API');
    }
  }

  async updateExchangeRate() {
    try {
      const rateData = await this.fetchUSDToBOBRate();
      
      // Save new rate to database
      const exchangeRate = new ExchangeRate({
        fromCurrency: 'USDT',
        toCurrency: 'BOB',
        rate: rateData.rate,
        source: rateData.source,
        metadata: rateData.metadata
      });

      await exchangeRate.save();
      
      logger.info(`Exchange rate updated: 1 USDT = ${rateData.rate} BOB`);
      
      return exchangeRate;
    } catch (error) {
      logger.error('Error updating exchange rate:', error);
      throw error;
    }
  }
}

const exchangeRateService = new ExchangeRateService();

// @route   GET /api/exchange/rates
// @desc    Get current exchange rates
// @access  Private
router.get('/rates', async (req, res) => {
  try {
    const { from = 'USDT', to = 'BOB' } = req.query;

    const latestRate = await ExchangeRate.getLatestRate(from, to);
    
    if (!latestRate) {
      return res.status(404).json({
        success: false,
        error: 'Exchange rate not found'
      });
    }

    // Get historical rates for comparison
    const historicalRates = await ExchangeRate.find({
      fromCurrency: from,
      toCurrency: to,
      isActive: true
    })
    .sort({ createdAt: -1 })
    .limit(24); // Last 24 rates

    res.json({
      success: true,
      data: {
        current: latestRate,
        historical: historicalRates,
        pair: `${from}/${to}`,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Get exchange rates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve exchange rates'
    });
  }
});

// @route   POST /api/exchange/rates/update
// @desc    Manually trigger exchange rate update
// @access  Private
router.post('/rates/update', async (req, res) => {
  try {
    const updatedRate = await exchangeRateService.updateExchangeRate();
    
    res.json({
      success: true,
      data: {
        rate: updatedRate.rate,
        fromCurrency: updatedRate.fromCurrency,
        toCurrency: updatedRate.toCurrency,
        source: updatedRate.source,
        metadata: updatedRate.metadata,
        updatedAt: updatedRate.createdAt
      }
    });
  } catch (error) {
    logger.error('Manual rate update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update exchange rate'
    });
  }
});

// @route   POST /api/exchange/rates/manual
// @desc    Manually set exchange rate (admin function)
// @access  Private
router.post('/rates/manual', async (req, res) => {
  try {
    const { rate, fromCurrency = 'USDT', toCurrency = 'BOB' } = req.body;

    if (!rate || isNaN(rate) || rate <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid exchange rate required'
      });
    }

    const exchangeRate = new ExchangeRate({
      fromCurrency,
      toCurrency,
      rate: parseFloat(rate),
      source: 'manual',
      metadata: {
        setBy: req.user.email,
        reason: 'Manual override'
      }
    });

    await exchangeRate.save();
    
    logger.info(`Exchange rate manually set by ${req.user.email}: 1 ${fromCurrency} = ${rate} ${toCurrency}`);

    res.json({
      success: true,
      data: {
        rate: exchangeRate.rate,
        fromCurrency: exchangeRate.fromCurrency,
        toCurrency: exchangeRate.toCurrency,
        source: exchangeRate.source,
        setBy: req.user.email,
        createdAt: exchangeRate.createdAt
      }
    });
  } catch (error) {
    logger.error('Manual rate set error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set exchange rate'
    });
  }
});

// @route   GET /api/exchange/rates/history
// @desc    Get exchange rate history with analytics
// @access  Private
router.get('/rates/history', async (req, res) => {
  try {
    const { 
      from = 'USDT', 
      to = 'BOB', 
      period = '24h',
      limit = 100 
    } = req.query;

    // Calculate date range based on period
    let startDate;
    const now = new Date();
    
    switch (period) {
      case '1h':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    const rates = await ExchangeRate.find({
      fromCurrency: from,
      toCurrency: to,
      isActive: true,
      createdAt: { $gte: startDate }
    })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit));

    // Calculate analytics
    const rateValues = rates.map(r => r.rate);
    const analytics = {
      count: rates.length,
      latest: rateValues[0] || 0,
      highest: Math.max(...rateValues) || 0,
      lowest: Math.min(...rateValues) || 0,
      average: rateValues.length > 0 ? rateValues.reduce((a, b) => a + b, 0) / rateValues.length : 0,
      volatility: rateValues.length > 1 ? calculateVolatility(rateValues) : 0
    };

    res.json({
      success: true,
      data: {
        rates: rates.reverse(), // Return in chronological order
        analytics,
        period,
        pair: `${from}/${to}`,
        dateRange: {
          from: startDate.toISOString(),
          to: now.toISOString()
        }
      }
    });
  } catch (error) {
    logger.error('Rate history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve rate history'
    });
  }
});

// Helper function to calculate volatility
function calculateVolatility(values) {
  if (values.length < 2) return 0;
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
  
  return Math.sqrt(avgSquaredDiff);
}

// Set up automatic rate updates using cron
if (process.env.NODE_ENV !== 'test') {
  // Update exchange rates every hour
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Running scheduled exchange rate update...');
      await exchangeRateService.updateExchangeRate();
    } catch (error) {
      logger.error('Scheduled rate update failed:', error);
    }
  });

  // Initial rate fetch on startup
  setTimeout(async () => {
    try {
      const latestRate = await ExchangeRate.getLatestRate('USDT', 'BOB');
      if (!latestRate) {
        logger.info('No exchange rate found, fetching initial rate...');
        await exchangeRateService.updateExchangeRate();
      }
    } catch (error) {
      logger.error('Initial rate fetch failed:', error);
    }
  }, 5000); // Wait 5 seconds after startup
}

module.exports = router;
