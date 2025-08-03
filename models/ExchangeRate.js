const mongoose = require('mongoose');

const exchangeRateSchema = new mongoose.Schema({
  fromCurrency: {
    type: String,
    required: true,
    default: 'USDT'
  },
  toCurrency: {
    type: String,
    required: true,
    default: 'BOB'
  },
  rate: {
    type: Number,
    required: true
  },
  source: {
    type: String,
    required: true,
    enum: ['api', 'manual', 'partner']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  metadata: {
    apiProvider: String,
    confidence: Number,
    spread: Number
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
exchangeRateSchema.index({ fromCurrency: 1, toCurrency: 1, createdAt: -1 });
exchangeRateSchema.index({ isActive: 1, createdAt: -1 });

// Static method to get latest rate
exchangeRateSchema.statics.getLatestRate = async function(from = 'USDT', to = 'BOB') {
  return this.findOne({
    fromCurrency: from,
    toCurrency: to,
    isActive: true
  }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('ExchangeRate', exchangeRateSchema);
