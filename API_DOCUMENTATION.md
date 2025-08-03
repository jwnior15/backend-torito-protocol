# ToritoWallet API Documentation

## Overview
The ToritoWallet API provides endpoints to interact with the ToritoWallet smart contract, allowing users to deposit USDT, request BOB loans, and manage their wallet operations.

## Contract Integration
The API now integrates with the ToritoWallet smart contract using the provided ABI. The contract handles:
- USDT deposits (automatically supplied to Aave for yield)
- USDT withdrawals (with collateral checks)
- BOB loan requests
- User account management

## Authentication
All wallet endpoints require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### GET /api/wallet/balance
Get user's wallet balances and account information.

**Response:**
```json
{
  "success": true,
  "data": {
    "walletAddress": "0x...",
    "balances": {
      "usdt": {
        "balance": 1000.50,
        "symbol": "USDT",
        "decimals": 6
      },
      "aUsdt": {
        "balance": 1000.50,
        "symbol": "aUSDT",
        "decimals": 6
      },
      "aave": {
        "totalCollateralETH": 0.5,
        "totalDebtETH": 0.0,
        "availableBorrowsETH": 0.25,
        "healthFactor": 1.15,
        "ltv": 50
      },
      "toritoWallet": {
        "usdtBalance": 500.00,
        "bobDebt": 100.50,
        "totalBobBorrowed": 150.00,
        "totalBobRepaid": 49.50,
        "isActive": true
      }
    },
    "contractStats": {
      "contractTotalDeposits": 50000.00,
      "contractTotalBobLoans": 10000.50
    },
    "timestamp": "2025-08-03T10:00:00.000Z"
  }
}
```

### POST /api/wallet/deposit
Deposit USDT to the ToritoWallet contract.

**Request Body:**
```json
{
  "amount": 100.50,
  "transactionHash": "0x..." // Optional: for verification
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amount": 100.50,
    "walletAddress": "0x...",
    "contractTransaction": {
      "transactionHash": "0x...",
      "blockNumber": 12345,
      "gasUsed": "150000"
    },
    "userAccount": {
      "usdtBalance": 600.50,
      "bobDebt": 100.50,
      "totalBobBorrowed": 150.00,
      "totalBobRepaid": 49.50,
      "isActive": true
    },
    "timestamp": "2025-08-03T10:00:00.000Z"
  }
}
```

### POST /api/wallet/withdraw
Withdraw USDT from the ToritoWallet contract.

**Request Body:**
```json
{
  "amount": 50.00,
  "usdtToBobRate": 0.0025 // Current USDT to BOB exchange rate
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amount": 50.00,
    "walletAddress": "0x...",
    "usdtToBobRate": 0.0025,
    "contractTransaction": {
      "transactionHash": "0x...",
      "blockNumber": 12346,
      "gasUsed": "120000"
    },
    "userAccount": {
      "usdtBalance": 550.50,
      "bobDebt": 100.50,
      "totalBobBorrowed": 150.00,
      "totalBobRepaid": 49.50,
      "isActive": true
    },
    "timestamp": "2025-08-03T10:00:00.000Z"
  }
}
```

### POST /api/wallet/loan/request
Request a BOB loan using USDT as collateral.

**Request Body:**
```json
{
  "bobAmount": 25.00, // Amount of BOB to borrow
  "usdtToBobRate": 0.0025 // Current USDT to BOB exchange rate
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "loanId": "123",
    "bobAmount": 25.00,
    "usdtToBobRate": 0.0025,
    "requiredCollateral": 125.00,
    "walletAddress": "0x...",
    "contractTransaction": {
      "transactionHash": "0x...",
      "blockNumber": 12347,
      "gasUsed": "180000"
    },
    "userAccount": {
      "usdtBalance": 550.50,
      "bobDebt": 125.50,
      "totalBobBorrowed": 175.00,
      "totalBobRepaid": 49.50,
      "isActive": true
    },
    "timestamp": "2025-08-03T10:00:00.000Z"
  }
}
```

### GET /api/wallet/loan/history
Get user's loan history.

**Response:**
```json
{
  "success": true,
  "data": {
    "walletAddress": "0x...",
    "loanIds": ["1", "2", "3", "123"],
    "totalLoans": 4,
    "timestamp": "2025-08-03T10:00:00.000Z"
  }
}
```

### GET /api/wallet/borrowing-capacity
Get user's borrowing capacity information.

**Query Parameters:**
- `usdtToBobRate`: Current USDT to BOB exchange rate (required)

**Response:**
```json
{
  "success": true,
  "data": {
    "walletAddress": "0x...",
    "usdtToBobRate": 0.0025,
    "currentBalance": 550.50,
    "currentDebt": 125.50,
    "maxBorrowable": 275.25,
    "availableToBorrow": 149.75,
    "utilizationRatio": 45.6,
    "isActive": true,
    "timestamp": "2025-08-03T10:00:00.000Z"
  }
}
```

### GET /api/wallet/gas-estimate
Get gas estimates for operations.

**Query Parameters:**
- `operation`: Type of operation (`deposit`, `withdraw`, `requestLoan`)
- `amount`: Amount for the operation (required)

**Response:**
```json
{
  "success": true,
  "data": {
    "operation": "deposit",
    "amount": 100.50,
    "gasEstimate": {
      "gasLimit": "200000",
      "gasPrice": "20000000000",
      "estimatedCost": "0.004"
    },
    "timestamp": "2025-08-03T10:00:00.000Z"
  }
}
```

### GET /api/wallet/transaction/:hash
Get transaction status.

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionHash": "0x...",
    "status": "confirmed",
    "blockNumber": 12345,
    "gasUsed": "150000",
    "confirmations": 15,
    "timestamp": "2025-08-03T10:00:00.000Z"
  }
}
```

## Error Responses

All endpoints return errors in the following format:
```json
{
  "success": false,
  "error": "Error message",
  "details": {} // Optional: additional error details
}
```

Common HTTP status codes:
- `400`: Bad Request (validation errors, insufficient funds, etc.)
- `401`: Unauthorized (invalid or missing JWT token)
- `500`: Internal Server Error (blockchain or contract errors)

## Contract Logic

### Loan-to-Value (LTV) Ratio
- The contract uses a 50% LTV ratio
- Users can borrow up to 50% of their USDT deposit value in BOB

### Collateral Requirements
- All BOB loans require USDT collateral
- Withdrawals are blocked if they would leave insufficient collateral
- The contract automatically calculates required collateral based on exchange rates

### Exchange Rate Integration
- All operations requiring BOB calculations need the current USDT to BOB exchange rate
- Rates should have 8 decimal places for precision
- Example: If 1 USDT = 400 BOB, the rate would be 0.0025 (1/400)

## Environment Variables Required

```env
# Blockchain Configuration
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your-key
PRIVATE_KEY=your-private-key

# Contract Addresses
SMART_CONTRACT_ADDRESS=0x... # ToritoWallet contract address
AAVE_POOL_ADDRESS=0x...      # Aave Pool contract address  
USDT_ADDRESS=0x...           # USDT token address
AUSDT_ADDRESS=0x...          # aUSDT token address
```
