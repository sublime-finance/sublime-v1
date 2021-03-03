// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/IYield.sol";
import "../interfaces/IRepayment.sol";
import "../interfaces/ISavingsAccount.sol";
import "../interfaces/IPool.sol";

// TODO: set modifiers to disallow any transfers directly
contract Pool is ERC20PresetMinterPauserUpgradeable,IPool {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    enum LoanStatus {
        COLLECTION, //denotes collection period
        ACTIVE,
        CLOSED,
        CANCELLED,
        DEFAULTED,
        TERMINATED
    }

    address public Repayment;
    // address public PriceOracle;
    address public PoolFactory;

    struct LendingDetails {
        uint256 amountWithdrawn;
        // bool lastVoteValue; // last vote value is not neccesary as in once cycle user can vote only once
        uint256 lastVoteTime;
        uint256 marginCallEndTime;
        uint256 extraLiquidityShares;
        bool canBurn;
    }

    address public borrower;
    uint256 public borrowAmountRequested;
    uint256 public minborrowAmountFraction; // min fraction for the loan to continue
    uint256 public loanStartTime;
    uint256 public matchCollateralRatioEndTime;
    address public borrowAsset;
    uint256 public collateralRatio;
    uint256 public borrowRate;
    uint256 public noOfRepaymentIntervals;
    uint256 public repaymentInterval;
    address public collateralAsset;
    
    uint256 public PeriodWhenExtensionIsPassed;   // will be set to noOfRepaymentIntervals+1 
    uint256 public baseLiquidityShares;
    uint256 public extraLiquidityShares;
    uint256 public liquiditySharesTokenAddress;
    LoanStatus public loanStatus;
    uint256 public totalExtensionSupport; // sum of weighted votes for extension
    address public investedTo;  // invest contract
    mapping(address => LendingDetails) public lenders;
    uint256 public extensionVoteEndTime;
    uint256 public noOfGracePeriodsTaken;
    uint256 public nextDuePeriod;
    uint256 public gracePeriodPenaltyFraction;
    event OpenBorrowPoolCreated(address poolCreator);
    event OpenBorrowPoolCancelled();
    event OpenBorrowPoolTerminated();
    event OpenBorrowPoolClosed();
    event OpenBorrowPoolDefaulted();
    event CollateralAdded(address borrower,uint256 amount,uint256 sharesReceived);
    event MarginCallCollateralAdded(address borrower,address lender,uint256 amount,uint256 sharesReceived);
    event CollateralWithdrawn(address user, uint256 amount);
    event liquiditySupplied(
        uint256 amountSupplied,
        address lenderAddress
    );
    event AmountBorrowed(address borrower, uint256 amount);
    event liquiditywithdrawn(
        uint256 amount,
        address lenderAddress
    );
    event CollateralCalled(address lenderAddress);
    event lenderVoted(address Lender);
    event LoanDefaulted();

    modifier OnlyBorrower {
        require(msg.sender == borrower, "Pool::OnlyBorrower - Only borrower can invoke");
        _;
    }

    modifier isLender(address _lender) {
        require(balanceOf(_lender) != 0, "Pool::isLender - Lender doesn't have any lTokens for the pool");
        _;
    }

    modifier onlyOwner {
        require(msg.sender == IPoolFactory(PoolFactory).owner(), "Pool::onlyOwner - Only owner can invoke");
        _;
    }

    modifier isPoolActive {
        require(loanStatus == LoanStatus.ACTIVE, "Pool::isPoolActive - Pool is  not active");
        _;
    }

    // TODO - decrease the number of arguments - stack too deep
    function initialize(
        uint256 _borrowAmountRequested,
        uint256 _minborrowAmountFraction, // represented as %
        address _borrower,
        address _borrowAsset,
        address _collateralAsset,
        uint256 _collateralRatio,
        uint256 _borrowRate,
        uint256 _repaymentInterval,
        uint256 _noOfRepaymentIntervals,
        address _investedTo,
        uint256 _collateralAmount,
        bool _transferFromSavingsAccount,
        uint256 _gracePeriodPenaltyFraction
    ) external initializer {
        super.initialize("Open Pool Tokens", "OPT");
        initializePoolParams(
            _borrowAmountRequested,
            _minborrowAmountFraction, // represented as %
            _borrower,
            _borrowAsset,
            _collateralAsset,
            _collateralRatio,
            _borrowRate,
            _repaymentInterval,
            _noOfRepaymentIntervals,
            _investedTo,
            _gracePeriodPenaltyFraction
        );
        PoolFactory = msg.sender;

        depositCollateral(_collateralAmount, _transferFromSavingsAccount);
        uint256 collectionPeriod = IPoolFactory(msg.sender).collectionPeriod();
        loanStartTime = block.timestamp.add(collectionPeriod);
        matchCollateralRatioEndTime = block.timestamp.add(collectionPeriod).add(IPoolFactory(msg.sender).matchCollateralRatioInterval());

        emit OpenBorrowPoolCreated(msg.sender);
    }

    function initializePoolParams(
        uint256 _borrowAmountRequested,
        uint256 _minborrowAmountFraction, // represented as %
        address _borrower,
        address _borrowAsset,
        address _collateralAsset,
        uint256 _collateralRatio,
        uint256 _borrowRate,
        uint256 _repaymentInterval,
        uint256 _noOfRepaymentIntervals,
        address _investedTo,
        uint256 _gracePeriodPenaltyFraction
    ) internal {
        borrowAmountRequested = _borrowAmountRequested;
        minborrowAmountFraction = _minborrowAmountFraction;
        borrower = _borrower;
        borrowAsset = _borrowAsset;
        collateralAsset = _collateralAsset;
        collateralRatio = _collateralRatio;
        borrowRate =  _borrowRate;
        repaymentInterval = _repaymentInterval;
        noOfRepaymentIntervals = _noOfRepaymentIntervals;
        investedTo = _investedTo;
        gracePeriodPenaltyFraction = _gracePeriodPenaltyFraction;
    }

    // Deposit collateral
    function depositCollateral(uint256 _amount,bool _transferFromSavingsAccount) public payable override {

        require(_amount != 0, "Pool::deposit - collateral amount");
        uint256 _sharesReceived;
        ISavingsAccount _savingAccount = ISavingsAccount(IPoolFactory(PoolFactory).savingsAccount());
        address _collateralAsset = collateralAsset;
        address _investedTo = investedTo;
        uint256 _liquidityshare = IYield(_investedTo).getTokensForShares(_amount, _collateralAsset);

        if(!_transferFromSavingsAccount){
            if(_collateralAsset == address(0)) {
                require(msg.value == _amount, "Pool::deposit - value to transfer doesn't match argument");
                _sharesReceived = _savingAccount.deposit{value:msg.value}(_amount,_collateralAsset,_investedTo, address(this));
            }
            else{
                _sharesReceived = _savingAccount.deposit(_amount,_collateralAsset,_investedTo, address(this));
            }
        }
        else{
            _sharesReceived = _savingAccount.transferFrom(borrower, address(this), _liquidityshare, _collateralAsset,_investedTo);
        }
        baseLiquidityShares = baseLiquidityShares.add(_sharesReceived);
        emit CollateralAdded(msg.sender,_amount,_sharesReceived);
    } 



    function addCollateralInMarginCall(address _lender,  uint256 _amount,bool _transferFromSavingsAccount) external payable override
    {
        require(loanStatus == LoanStatus.ACTIVE, "Pool::addCollateralMarginCall - Loan needs to be in Active stage to deposit"); 
        require(lenders[_lender].marginCallEndTime >= block.timestamp, "Pool::addCollateralMarginCall - Can't Add after time is completed");
        require(_amount !=0, "Pool::addCollateralMarginCall - collateral amount");

        uint256 _sharesReceived;
        ISavingsAccount _savingAccount = ISavingsAccount(IPoolFactory(PoolFactory).savingsAccount());
        address _collateralAsset = collateralAsset;
        address _investedTo = investedTo;
        uint256 _liquidityshare = IYield(_investedTo).getTokensForShares(_amount, _collateralAsset);

        if(!_transferFromSavingsAccount){
            if(_collateralAsset == address(0)) {
                require(msg.value == _amount, "Pool::addCollateralMarginCall - value to transfer doesn't match argument");
                _sharesReceived = _savingAccount.deposit{value:msg.value}(_amount,_collateralAsset,_investedTo, address(this));
            }
            else{
                IERC20(collateralAsset).approve(_investedTo, _amount);
                _sharesReceived = _savingAccount.deposit(_amount,_collateralAsset,_investedTo, address(this));
            }
        }
        else{
            _sharesReceived = _savingAccount.transferFrom(borrower, address(this), _liquidityshare, _collateralAsset,_investedTo);
        }

        extraLiquidityShares = extraLiquidityShares.add(_sharesReceived);
        lenders[_lender].extraLiquidityShares = lenders[_lender].extraLiquidityShares.add(_sharesReceived);
        emit MarginCallCollateralAdded(msg.sender,_lender,_amount,_sharesReceived);
    }	    
    

    function withdrawBorrowedAmount()
        external
        OnlyBorrower override
    {
        if(loanStatus == LoanStatus.COLLECTION && loanStartTime < block.timestamp) {
            if(totalSupply() < borrowAmountRequested.mul(minborrowAmountFraction).div(100)) {
                loanStatus = LoanStatus.CANCELLED;
                return;
            }
            loanStatus = LoanStatus.ACTIVE;
        }
        require(
            loanStatus == LoanStatus.ACTIVE,
            "Borrower: Loan is not in ACTIVE state"
        );
        uint256 _currentCollateralRatio = getCurrentCollateralRatio();
        require(_currentCollateralRatio > collateralRatio.sub(IPoolFactory(PoolFactory).collateralVolatilityThreshold()), "Pool::withdrawBorrowedAmount - The current collateral amount does not permit the loan.");

        uint256 _tokensLent = totalSupply();
        IERC20(borrowAsset).transfer(borrower, _tokensLent);
        
        delete matchCollateralRatioEndTime;
        emit AmountBorrowed(
            msg.sender,
            _tokensLent
        );   
    }


    function repayAmount(uint256 amount)
        external
        OnlyBorrower
        isPoolActive
    {
        
    }

    function withdrawAllCollateral()
        external
        OnlyBorrower
    {
        LoanStatus _status = loanStatus;
        require(
            _status == LoanStatus.CLOSED || _status == LoanStatus.CANCELLED,
            "Pool::withdrawAllCollateral: Loan is not CLOSED or CANCELLED"
        );

        uint256 _collateralShares = baseLiquidityShares.add(extraLiquidityShares);
        uint256 _sharesReceived = ISavingsAccount(IPoolFactory(PoolFactory).savingsAccount()).transfer(msg.sender,_collateralShares,collateralAsset,investedTo);
        emit CollateralWithdrawn(msg.sender, _sharesReceived);
        delete baseLiquidityShares;
        delete extraLiquidityShares;
    }


    function lend(address _lender, uint256 _amountLent) external {
        
    }

    function _beforeTransfer(address _user) internal {
        
    }

    function transfer(address _recipient, uint256 _amount) public override returns(bool) {
        
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) public virtual override returns (bool) {
        
    }


    function cancelOpenBorrowPool()
        external
        OnlyBorrower
    {   
        
    }


    
    function terminateOpenBorrowPool()
        external
        onlyOwner
    {
        
    }

    // TODO: repay function will invoke this fn
    function closeLoan()
        internal
        // onlyOwner // TODO: to be updated  --fixed
    {
        
    }

    // TODO: When repay is missed (interest/principle) call this
    function defaultLoan()
        internal
        // onlyOwner // TODO: to be updated
    {
        
    }

    function calculateLendingRate(uint256 s) public pure returns (uint256) {
        
    }

    // Note - Only when cancelled or terminated, lender can withdraw
    function withdrawLiquidity(address lenderAddress)
        external
    {
        
    }


    function resultOfVoting() external isPoolActive{

        (PeriodWhenExtensionIsPassed,nextDuePeriod) = IRepayment(Repayment).resultOfVoting(totalExtensionSupport, extensionVoteEndTime, totalSupply(),nextDuePeriod,repaymentInterval,loanStartTime,PeriodWhenExtensionIsPassed);
    }

    function requestExtension() external OnlyBorrower isPoolActive
    {
        require(PeriodWhenExtensionIsPassed > noOfRepaymentIntervals,"Pool::requestExtension: you have already been given an extension,No more extension");
        extensionVoteEndTime = IRepayment(Repayment).requestExtension(extensionVoteEndTime);
        totalExtensionSupport = 0;
        
    }

    function voteOnExtension() external isPoolActive 
    {
        require(balanceOf(msg.sender)!=0 , "Pool::voteOnExtension - insufficient balance for vote");
        (lenders[msg.sender].lastVoteTime,totalExtensionSupport) = IRepayment(Repayment).voteOnExtension(msg.sender,lenders[msg.sender].lastVoteTime,extensionVoteEndTime, balanceOf(msg.sender),totalExtensionSupport);

    }


    function requestCollateralCall()
        public
    {
        
    }

    

    function transferRepayImpl(address repayment) external onlyOwner {
        
    }

    // function transferLenderImpl(address lenderImpl) external onlyOwner {
    //     require(lenderImpl != address(0), "Borrower: Lender address");
    //     _lender = lenderImpl;
    // }

    // event PoolLiquidated(bytes32 poolHash, address liquidator, uint256 amount);
    //todo: add more details here
    event Liquidated(address liquidator, address lender);

    function amountPerPeriod() public view returns(uint256){
        
    }

    function interestTillNow(uint256 _balance, uint256 _interestPerPeriod) public view returns(uint256){
        uint256 _repaymentLength = repaymentInterval;
        uint256 _loanStartedAt = loanStartTime;
        uint256 _totalSupply = totalSupply();
        (uint256 _interest, uint256 _gracePeriodsTaken) =
            (
                IRepayment(Repayment).calculateRepayAmount(
                    _totalSupply,
                    _repaymentLength,
                    borrowRate,
                    _loanStartedAt,
                    nextDuePeriod,
                    periodWhenExtensionIsRequested
                )
            );
        uint256 _extraInterest =
            interestPerSecond(_balance).mul(
                ((calculateCurrentPeriod().add(1)).mul(_repaymentLength))
                    .add(_loanStartedAt)
                    .sub(block.timestamp)
            );
        _interest = _interest.sub(
            gracePeriodPenaltyFraction.mul(_interestPerPeriod).div(100).mul(
                _gracePeriodsTaken
            )
        );
        if (_interest < _extraInterest) {
            _interest = 0;
        } else {
            _interest = _interest.sub(_extraInterest);
        }
    }

    function calculateCollateralRatio(uint256 _interestPerPeriod, uint256 _balance, uint256 _liquidityShares) public returns(uint256){
        uint256 _interest = interestTillNow(_balance, _interestPerPeriod);
        address _collateralAsset = collateralAsset;
        uint256 _ratioOfPrices =
            IPriceOracle(IPoolFactory(PoolFactory).priceOracle())
                .getLatestPrice(_collateralAsset, borrowAsset);
        uint256 _currentCollateralTokens =
            IYield(investedTo).getTokensForShares(
                _liquidityShares,
                _collateralAsset
            );
        uint256 _ratio = (_currentCollateralTokens.mul(_ratioOfPrices).div(100000000)).div(
            _balance.add(_interest)
        );
        return(_ratio);
    }

    function getCurrentCollateralRatio() public returns (uint256) {
        uint256 _liquidityShares = baseLiquidityShares.add(extraLiquidityShares);
        return(calculateCollateralRatio(amountPerPeriod(), totalSupply(), _liquidityShares));
    }

    function getCurrentCollateralRatio(address _lender)
        public
        returns (uint256 _ratio)
    {
        uint256 _balanceOfLender = balanceOf(_lender);
        uint256 _liquidityShares = (baseLiquidityShares.mul(_balanceOfLender).div(totalSupply()))
                    .add(lenders[_lender].extraLiquidityShares); 
        return(calculateCollateralRatio(interestPerPeriod(balanceOf(_lender)), _balanceOfLender, _liquidityShares));
    }
   
    function liquidateLender(address lender)
        public
    {
        
    }

    function liquidatePool() external {}
        
    function interestPerSecond(uint256 _principle)
        public
        view
        returns (uint256)
    {
        uint256 _interest = ((_principle).mul(borrowRate)).div(365 days);
        return _interest;
    }
    
    function interestPerPeriod(uint256 _balance)
        public
        view
        returns (uint256)
    {
        return (interestPerSecond(_balance).mul(repaymentInterval));
    }

    function calculateCurrentPeriod() public view returns (uint256) {
        uint256 _currentPeriod =
            (block.timestamp.sub(loanStartTime, "Pool:: calculateCurrentPeriod - The loan has not started.")).div(repaymentInterval);
        return _currentPeriod;
    }
    
    // Withdraw Repayment, Also all the extra state variables are added here only for the review
    
    function withdrawRepayment() external payable {
        
    }

    function transferTokensRepayments(uint256 amount, address from, address to) internal{
        
    }

    function calculatewithdrawRepayment(address lender) public view returns(uint256)
    {
        
    }


    function _withdrawRepayment(address lender) internal {

        

    }



    // function getLenderCurrentCollateralRatio(address lender) public view returns(uint256){

    // }

    // function addCollateralMarginCall(address lender,uint256 amount) external payable
    // {
    //     require(loanStatus == LoanStatus.ACTIVE, "Pool::deposit - Loan needs to be in Active stage to deposit"); // update loan status during next interaction after collection period 
    //     require(lenders[lender].marginCallEndTime > block.timestamp, "Pool::deposit - Can't Add after time is completed");
    //     _deposit(_amount);
    // }
}