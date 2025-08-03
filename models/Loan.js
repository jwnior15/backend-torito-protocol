const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  loanId: {
    type: String,
    required: true,
    unique: true
  },
  collateral: {
    amount: {
      type: Number,
      required: true
    },
    token: {
      type: String,
      default: 'aUSDT'
    },
    usdValue: {
      type: Number,
      required: true
    }
  },
  loan: {
    amountBOB: {
      type: Number,
      required: true
    },
    amountUSD: {
      type: Number,
      required: true
    },
    exchangeRate: {
      type: Number,
      required: true
    },
    ltvRatio: {
      type: Number,
      required: true,
      default: 0.75
    }
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'funded', 'repaid', 'liquidated', 'cancelled'],
    default: 'pending'
  },
  partner: {
    orderId: String,
    transferId: String,
    bankDetails: {
      accountNumber: String,
      bankName: String,
      accountHolder: String
    }
  },
  blockchain: {
    transactionHash: String,
    blockNumber: Number,
    contractAddress: String
  },
  repayment: {
    dueDate: Date,
    repaidAt: Date,
    repaidAmount: Number,
    partnerConfirmation: {
      confirmed: {
        type: Boolean,
        default: false
      },
      confirmedAt: Date,
      confirmationId: String
    }
  },
  liquidation: {
    liquidatedAt: Date,
    liquidationPrice: Number,
    liquidationTxHash: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
loanSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Generate unique loan ID
loanSchema.pre('save', async function(next) {
  if (!this.loanId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    this.loanId = `LOAN-${timestamp}-${random}`.toUpperCase();
  }
  next();
});

// Index for efficient queries
loanSchema.index({ userId: 1, status: 1 });
loanSchema.index({ loanId: 1 });
loanSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Loan', loanSchema);
