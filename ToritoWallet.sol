// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAave.sol";

/**
 * @title ToritoWallet
 * @dev Smart contract for mobile e-wallet dApp with USDT deposits and BOB loans
 * Users deposit USDT which is supplied to Aave for yield generation
 * BOB loans are tracked internally with off-chain fulfillment
 */
contract ToritoWallet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // State variables
    IERC20 public immutable usdt;
    IERC20 public immutable aUsdt;
    IPool public immutable aavePool;
    
    uint256 public constant RATE_DECIMALS = 8;
    uint256 public constant LTV_RATIO = 50; // 50% LTV
    uint256 public constant PRECISION = 100;
    uint256 public totalDeposits;
    uint256 public totalBobLoans;
    
    // User data structures
    struct UserAccount {
        uint256 usdtBalance;        // User's USDT deposit balance
        uint256 bobDebt;           // User's debt in BOB (with 2 decimals)
        uint256 totalBobBorrowed;  // Total BOB ever borrowed
        uint256 totalBobRepaid;    // Total BOB repaid
        bool isActive;             // Account status
    }
    
    struct LoanRequest {
        address user;
        uint256 bobAmount;         // BOB amount requested (with 2 decimals)
        uint256 usdtCollateral;    // USDT collateral used
        uint256 timestamp;
        bool fulfilled;
        bool repaid;
    }
    
    // Mappings
    mapping(address => UserAccount) public userAccounts;
    mapping(uint256 => LoanRequest) public loanRequests;
    mapping(address => uint256[]) public userLoanIds;
    
    uint256 public nextLoanId = 1;
    
    // Events
    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event LoanRequested(address indexed user, uint256 loanId, uint256 bobAmount, uint256 usdtCollateral, uint256 rate);
    event LoanFulfilled(uint256 indexed loanId);
    event RepaymentRecorded(address indexed user, uint256 bobAmount);
    
    // Modifiers
    modifier validUser(address user) {
        require(user != address(0), "Invalid user address");
        _;
    }
    
    modifier validRate(uint256 rate) {
        require(rate > 0, "Rate must be positive");
        _;
    }
    
    constructor(
        address _usdt,
        address _aUsdt,
        address _aavePool
    ) Ownable(msg.sender) {
        require(_usdt != address(0), "Invalid USDT address");
        require(_aUsdt != address(0), "Invalid aUSDT address");
        require(_aavePool != address(0), "Invalid Aave pool address");
        
        usdt = IERC20(_usdt);
        aUsdt = IERC20(_aUsdt);
        aavePool = IPool(_aavePool);
    }
    
    /**
     * @dev Deposit USDT and supply to Aave
     * @param amount Amount of USDT to deposit
     */
    function deposit(uint256 amount) external nonReentrant validUser(msg.sender) {
        require(amount > 0, "Amount must be positive");
        
        // Transfer USDT from user
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        
        // Approve and supply to Aave
        usdt.forceApprove(address(aavePool), amount);
        aavePool.supply(address(usdt), amount, address(this), 0);
        
        // Update user balance
        userAccounts[msg.sender].usdtBalance += amount;
        userAccounts[msg.sender].isActive = true;
        totalDeposits += amount;
        
        emit Deposit(msg.sender, amount);
    }
    
    /**
     * @dev Withdraw USDT from Aave and transfer to user
     * @param amount Amount of USDT to withdraw
     * @param usdtToBobRate Current USDT to BOB exchange rate (with 8 decimals)
     */
    function withdraw(uint256 amount, uint256 usdtToBobRate) 
        external 
        nonReentrant 
        validRate(usdtToBobRate)
    {
        UserAccount storage account = userAccounts[msg.sender];
        require(amount > 0, "Amount must be positive");
        require(account.usdtBalance >= amount, "Insufficient balance");
        
        // Check if withdrawal would leave insufficient collateral (only if user has debt)
        if (account.bobDebt > 0) {
            uint256 remainingBalance = account.usdtBalance - amount;
            uint256 requiredCollateral = calculateRequiredCollateral(account.bobDebt, usdtToBobRate);
            require(remainingBalance >= requiredCollateral, "Would leave insufficient collateral");
        }
        
        // Withdraw from Aave
        uint256 withdrawnAmount = aavePool.withdraw(address(usdt), amount, address(this));
        
        // Update user balance
        account.usdtBalance -= amount;
        totalDeposits -= amount;
        
        // Transfer to user
        usdt.safeTransfer(msg.sender, withdrawnAmount);
        
        emit Withdrawal(msg.sender, withdrawnAmount);
    }
    
    /**
     * @dev Request a loan in BOB
     * @param bobAmount Amount of BOB requested (with 2 decimals)
     * @param usdtToBobRate Current USDT to BOB exchange rate (with 8 decimals)
     */
    function requestLoan(uint256 bobAmount, uint256 usdtToBobRate) 
        external 
        nonReentrant 
        validRate(usdtToBobRate)
        returns (uint256 loanId) 
    {
        require(bobAmount > 0, "BOB amount must be positive");
        
        UserAccount storage account = userAccounts[msg.sender];
        require(account.isActive, "Account not active");
        
        // Calculate required USDT collateral
        uint256 requiredCollateral = calculateRequiredCollateral(bobAmount, usdtToBobRate);
        require(account.usdtBalance >= requiredCollateral, "Insufficient collateral");
        
        // Check if user can take additional debt
        uint256 newTotalDebt = account.bobDebt + bobAmount;
        uint256 maxBorrowable = calculateMaxBorrowable(account.usdtBalance, usdtToBobRate);
        require(newTotalDebt <= maxBorrowable, "Exceeds borrowing capacity");
        
        // Create loan request
        loanId = nextLoanId++;
        loanRequests[loanId] = LoanRequest({
            user: msg.sender,
            bobAmount: bobAmount,
            usdtCollateral: requiredCollateral,
            timestamp: block.timestamp,
            fulfilled: false,
            repaid: false
        });
        
        // Update user debt
        account.bobDebt += bobAmount;
        account.totalBobBorrowed += bobAmount;
        totalBobLoans += bobAmount;
        
        // Add to user's loan history
        userLoanIds[msg.sender].push(loanId);
        
        emit LoanRequested(msg.sender, loanId, bobAmount, requiredCollateral, usdtToBobRate);
        
        return loanId;
    }
    
    /**
     * @dev Mark a loan as fulfilled (called by owner)
     * @param loanId ID of the loan to mark as fulfilled
     */
    function fulfillLoan(uint256 loanId) external onlyOwner {
        LoanRequest storage loan = loanRequests[loanId];
        require(loan.user != address(0), "Loan does not exist");
        require(!loan.fulfilled, "Loan already fulfilled");
        
        loan.fulfilled = true;
        
        emit LoanFulfilled(loanId);
    }
    
    /**
     * @dev Record BOB repayment made off-chain
     * @param user User who made the repayment
     * @param bobAmount Amount of BOB repaid (with 2 decimals)
     */
    function recordRepayment(address user, uint256 bobAmount) 
        external 
        onlyOwner 
        validUser(user) 
    {
        require(bobAmount > 0, "Repayment amount must be positive");
        
        UserAccount storage account = userAccounts[user];
        require(account.bobDebt >= bobAmount, "Repayment exceeds debt");
        
        // Update user debt
        account.bobDebt -= bobAmount;
        account.totalBobRepaid += bobAmount;
        totalBobLoans -= bobAmount;
        
        emit RepaymentRecorded(user, bobAmount);
    }
    

    
    /**
     * @dev Calculate maximum BOB amount user can borrow
     * @param usdtBalance User's USDT balance
     * @param usdtToBobRate Current USDT to BOB exchange rate (with 8 decimals)
     * @return Maximum borrowable BOB amount
     */
    function calculateMaxBorrowable(uint256 usdtBalance, uint256 usdtToBobRate) public pure returns (uint256) {
        // Convert USDT to BOB and apply LTV ratio
        // usdtBalance has 6 decimals, rate has 8 decimals, result should have 2 decimals (BOB)
        uint256 bobValue = (usdtBalance * usdtToBobRate) / (10 ** (RATE_DECIMALS + 6 - 2));
        return (bobValue * LTV_RATIO) / PRECISION;
    }
    
    /**
     * @dev Calculate required USDT collateral for BOB amount
     * @param bobAmount BOB amount (with 2 decimals)
     * @param usdtToBobRate Current USDT to BOB exchange rate (with 8 decimals)
     * @return Required USDT collateral
     */
    function calculateRequiredCollateral(uint256 bobAmount, uint256 usdtToBobRate) public pure returns (uint256) {
        // Convert BOB to USDT and apply inverse LTV ratio
        // bobAmount has 2 decimals, rate has 8 decimals, result should have 6 decimals (USDT)
        uint256 usdtValue = (bobAmount * (10 ** (RATE_DECIMALS + 6 - 2))) / usdtToBobRate;
        return (usdtValue * PRECISION) / LTV_RATIO;
    }
    
    /**
     * @dev Get user account information
     * @param user User address
     * @return UserAccount struct
     */
    function getUserAccount(address user) external view returns (UserAccount memory) {
        return userAccounts[user];
    }
    
    /**
     * @dev Get user's loan IDs
     * @param user User address
     * @return Array of loan IDs
     */
    function getUserLoanIds(address user) external view returns (uint256[] memory) {
        return userLoanIds[user];
    }
    
    /**
     * @dev Get current aUSDT balance of the contract
     * @return aUSDT balance
     */
    function getAUsdtBalance() external view returns (uint256) {
        return aUsdt.balanceOf(address(this));
    }
    
    /**
     * @dev Get contract statistics
     * @return totalDeposits Total USDT deposits
     * @return totalBobLoans Total outstanding BOB loans
     */
    function getContractStats() external view returns (uint256, uint256) {
        return (totalDeposits, totalBobLoans);
    }
    
    /**
     * @dev Emergency function to recover tokens (only owner)
     * @param token Token address to recover
     * @param amount Amount to recover
     */
    function emergencyRecoverToken(address token, uint256 amount) external onlyOwner {
        require(token != address(usdt) && token != address(aUsdt), "Cannot recover main tokens");
        IERC20(token).safeTransfer(owner(), amount);
    }
}
