// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;

import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts-upgradeable/proxy/Initializable.sol';
import '../interfaces/IPoolFactory.sol';
import '../interfaces/IPriceOracle.sol';
import '../interfaces/IYield.sol';
import '../interfaces/IRepayment.sol';
import '../interfaces/ISavingsAccount.sol';
import '../SavingsAccount/SavingsAccountUtil.sol';
import '../interfaces/IPool.sol';
import '../interfaces/IExtension.sol';
import '../interfaces/IPoolToken.sol';

import 'hardhat/console.sol';

contract Pool is Initializable, IPool, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    enum LoanStatus {
        COLLECTION, //denotes collection period
        ACTIVE, // denotes the active loan
        CLOSED, // Loan is repaid and closed
        CANCELLED, // Cancelled by borrower
        DEFAULTED, // Repayment defaulted by  borrower
        TERMINATED // Pool terminated by admin
    }

    address PoolFactory;
    IPoolToken public poolToken;

    struct LendingDetails {
        uint256 principalWithdrawn;
        uint256 interestWithdrawn;
        uint256 lastVoteTime;
        uint256 marginCallEndTime;
        uint256 extraLiquidityShares;
    }

    // Pool constants
    struct PoolConstants {
        address borrower;
        uint256 borrowAmountRequested;
        uint256 minborrowAmount;
        uint256 loanStartTime;
        uint256 loanWithdrawalDeadline;
        address borrowAsset;
        uint256 idealCollateralRatio;
        uint256 borrowRate;
        uint256 noOfRepaymentIntervals;
        uint256 repaymentInterval;
        address collateralAsset;
        address poolSavingsStrategy; // invest contract
    }

    struct PoolVars {
        uint256 baseLiquidityShares;
        uint256 extraLiquidityShares;
        LoanStatus loanStatus;
        uint256 penalityLiquidityAmount;
    }

    mapping(address => LendingDetails) public lenders;
    PoolConstants public poolConstants;
    PoolVars public poolVars;

    /*
     * @notice Emitted when pool is cancelled either on borrower request or insufficient funds collected
     */
    event OpenBorrowPoolCancelled();

    /*
     * @notice Emitted when pool is terminated by admin
     */
    event OpenBorrowPoolTerminated();

    /*
     * @notice Emitted when pool is closed after repayments are complete
     */
    event OpenBorrowPoolClosed();

    // borrower and sharesReceived might not be necessary
    /*
     * @notice emitted when borrower posts collateral
     * @param borrower address of the borrower
     * @param amount amount denominated in collateral asset
     * @param sharesReceived shares received after transferring collaterla to pool savings strategy
     */
    event CollateralAdded(address borrower, uint256 amount, uint256 sharesReceived);

    // borrower and sharesReceived might not be necessary
    /*
     * @notice emitted when borrower posts collateral after a margin call
     * @param borrower address of the borrower
     * @param lender lender who margin called
     * @param amount amount denominated in collateral asset
     * @param sharesReceived shares received after transferring collaterla to pool savings strategy
     */
    event MarginCallCollateralAdded(address borrower, address lender, uint256 amount, uint256 sharesReceived);

    /*
     * @notice emitted when borrower withdraws excess collateral
     * @param borrower address of borrower
     * @param amount amount of collateral withdrawn
     */
    event CollateralWithdrawn(address borrower, uint256 amount);

    /*
     * @notice emitted when lender supplies liquidity to a pool
     * @param amountSupplied amount that was supplied
     * @param lenderAddress address of the lender. allows for delegation of lending
     */
    event LiquiditySupplied(uint256 amountSupplied, address lenderAddress);

    /*
     * @notice emitted when borrower withdraws loan
     * @param amount tokens the borrower withdrew
     */
    event AmountBorrowed(uint256 amount);

    /*
     * @notice emitted when lender withdraws from borrow pool
     * @param amount amount that lender withdraws from borrow pool
     * @param lenderAddress address to which amount is withdrawn
     */
    event LiquidityWithdrawn(uint256 amount, address lenderAddress);

    /*
     * @notice emitted when lender exercises a margin/collateral call
     * @param lenderAddress address of the lender who exercises margin calls
     */
    event MarginCalled(address lenderAddress);

    /*
     * @notice emitted when collateral backing lender is liquidated because of a margin call
     * @param liquidator address that calls the liquidateLender() function
     * @param lender lender who initially exercised the margin call
     * @param _tokenReceived amount received by liquidator denominated in collateral asset
     */
    event LenderLiquidated(address liquidator, address lender, uint256 _tokenReceived);

    /*
     * @notice emitted when a pool is liquidated for missing repayment
     * @param liquidator address of the liquidator
     */
    event PoolLiquidated(address liquidator);

    modifier OnlyBorrower(address _user) {
        require(_user == poolConstants.borrower, '1');
        _;
    }

    modifier isLender(address _lender) {
        require(poolToken.balanceOf(_lender) != 0, '2');
        _;
    }

    modifier onlyOwner {
        require(msg.sender == IPoolFactory(PoolFactory).owner(), '3');
        _;
    }

    modifier onlyExtension {
        require(msg.sender == IPoolFactory(PoolFactory).extension(), '5');
        _;
    }

    modifier OnlyRepaymentImpl {
        require(msg.sender == IPoolFactory(PoolFactory).repaymentImpl(), '25');
        _;
    }

    function initialize(
        uint256 _borrowAmountRequested,
        uint256 _minborrowAmount,
        address _borrower,
        address _borrowAsset,
        address _collateralAsset,
        uint256 _idealCollateralRatio,
        uint256 _borrowRate,
        uint256 _repaymentInterval,
        uint256 _noOfRepaymentIntervals,
        address _poolSavingsStrategy,
        uint256 _collateralAmount,
        bool _transferFromSavingsAccount,
        uint256 _loanWithdrawalDuration,
        uint256 _collectionPeriod
    ) external payable initializer {
        PoolFactory = msg.sender;
        poolConstants.borrowAsset = _borrowAsset;
        poolConstants.idealCollateralRatio = _idealCollateralRatio;
        poolConstants.collateralAsset = _collateralAsset;
        poolConstants.poolSavingsStrategy = _poolSavingsStrategy;
        poolConstants.borrowAmountRequested = _borrowAmountRequested;

        _initialDeposit(_borrower, _collateralAmount, _transferFromSavingsAccount);

        poolConstants.borrower = _borrower;
        poolConstants.minborrowAmount = _minborrowAmount;
        poolConstants.borrowRate = _borrowRate;
        poolConstants.noOfRepaymentIntervals = _noOfRepaymentIntervals;
        poolConstants.repaymentInterval = _repaymentInterval;

        poolConstants.loanStartTime = block.timestamp.add(_collectionPeriod);
        poolConstants.loanWithdrawalDeadline = block.timestamp.add(_collectionPeriod).add(_loanWithdrawalDuration);
    }

    /*
     * @notice Each pool has a unique pool token deployed by PoolFactory
     * @param _poolToken address of the PoolToken contract deployed for a loan request
     */
    function setPoolToken(address _poolToken) external override {
        require(msg.sender == PoolFactory, '6');
        poolToken = IPoolToken(_poolToken);
    }

    /*
     * @notice add collateral to a pool
     * @param _amount amount of collateral to be deposited denominated in collateral aseset
     * @param _transferFromSavingsAccount if true, collateral is transferred from msg.sender's savings account, if false, it is transferred from their wallet
     */
    function depositCollateral(uint256 _amount, bool _transferFromSavingsAccount) public payable override {
        require(_amount != 0, '7');
        _depositCollateral(msg.sender, _amount, _transferFromSavingsAccount);
    }

    /*
     * @notice called when borrow pool is initialized to make initial collateral deposit
     * @param _borrower address of the borrower
     * @param _amount amount of collateral getting deposited denominated in collateral asset
     * @param _transferFromSavingsAccount if true, collateral is transferred from msg.sender's savings account, if false, it is transferred from their wallet
     */
    function _initialDeposit(
        address _borrower,
        uint256 _amount,
        bool _transferFromSavingsAccount
    ) internal {
        uint256 _equivalentCollateral =
            getEquivalentTokens(
                poolConstants.borrowAsset,
                poolConstants.collateralAsset,
                poolConstants.borrowAmountRequested
            );
        require(_amount >= poolConstants.idealCollateralRatio.mul(_equivalentCollateral).div(1e30), '36');

        _depositCollateral(_borrower, _amount, _transferFromSavingsAccount);
    }

    /*
     * @notice internal function used to deposit collateral from _borrower to pool
     * @param _sender address transferring the collateral
     * @param _amount amount of collateral to be transferred denominated in collateral asset
     * @param _transferFromSavingsAccount if true, collateral is transferred from _sender's savings account, if false, it is transferred from _sender's wallet
     */
    function _depositCollateral(
        address _depositor,
        uint256 _amount,
        bool _transferFromSavingsAccount
    ) internal {
        uint256 _sharesReceived =
            _deposit(
                _transferFromSavingsAccount,
                true,
                poolConstants.collateralAsset,
                _amount,
                poolConstants.poolSavingsStrategy,
                _depositor,
                address(this)
            );
        poolVars.baseLiquidityShares = poolVars.baseLiquidityShares.add(_sharesReceived);
        emit CollateralAdded(_depositor, _amount, _sharesReceived);
    }

    /*
    * @notice internal function reused to perform deposits
    * @param _fromSavingsAccount if true, _amount is withdrawn from _depositFrom's Savings Account
    * @param _toSavingsAccount if true, _amount is deposited to _depositTo's Savings Account
    * @param _asset asset to be deposited
    * @param _amount amount to be deposited
    * @param _poolSavingsStrategy strategy to be used to m
    */
    function _deposit(
        bool _fromSavingsAccount,
        bool _toSavingsAccount,
        address _asset,
        uint256 _amount,
        address _poolSavingsStrategy,
        address _depositFrom,
        address _depositTo
    ) internal returns (uint256 _sharesReceived) {
        if (_fromSavingsAccount) {
            _sharesReceived = SavingsAccountUtil.depositFromSavingsAccount(
                ISavingsAccount(IPoolFactory(PoolFactory).savingsAccount()),
                _depositFrom,
                _depositTo,
                _amount,
                _asset,
                _poolSavingsStrategy,
                true,
                _toSavingsAccount
            );
        } else {
            _sharesReceived = SavingsAccountUtil.directDeposit(
                ISavingsAccount(IPoolFactory(PoolFactory).savingsAccount()),
                _depositFrom,
                _depositTo,
                _amount,
                _asset,
                _toSavingsAccount,
                _poolSavingsStrategy
            );
        }
    }

    function addCollateralInMarginCall(
        address _lender,
        uint256 _amount,
        bool _transferFromSavingsAccount
    ) external payable override {
        require(poolVars.loanStatus == LoanStatus.ACTIVE, '9');

        require(getMarginCallEndTime(_lender) >= block.timestamp, '10');

        require(_amount != 0, '11');

        uint256 _sharesReceived =
            _deposit(
                _transferFromSavingsAccount,
                true,
                poolConstants.collateralAsset,
                _amount,
                poolConstants.poolSavingsStrategy,
                msg.sender,
                address(this)
            );

        poolVars.extraLiquidityShares = poolVars.extraLiquidityShares.add(_sharesReceived);

        lenders[_lender].extraLiquidityShares = lenders[_lender].extraLiquidityShares.add(_sharesReceived);

        if (getCurrentCollateralRatio(_lender) >= poolConstants.idealCollateralRatio) {
            delete lenders[_lender].marginCallEndTime;
        }

        emit MarginCallCollateralAdded(msg.sender, _lender, _amount, _sharesReceived);
    }

    function withdrawBorrowedAmount() external override OnlyBorrower(msg.sender) nonReentrant {
        LoanStatus _poolStatus = poolVars.loanStatus;
        uint256 _tokensLent = poolToken.totalSupply();
        require(_poolStatus == LoanStatus.COLLECTION && poolConstants.loanStartTime < block.timestamp, '12');
        require(_tokensLent >= poolConstants.minborrowAmount, '');

        poolVars.loanStatus = LoanStatus.ACTIVE;
        uint256 _currentCollateralRatio = getCurrentCollateralRatio();
        IPoolFactory _poolFactory = IPoolFactory(PoolFactory);
        require(
            _currentCollateralRatio >=
                poolConstants.idealCollateralRatio.sub(_poolFactory.collateralVolatilityThreshold()),
            '13'
        );

        uint256 _noOfRepaymentIntervals = poolConstants.noOfRepaymentIntervals;
        uint256 _repaymentInterval = poolConstants.repaymentInterval;
        IRepayment(_poolFactory.repaymentImpl()).initializeRepayment(
            _noOfRepaymentIntervals,
            _repaymentInterval,
            poolConstants.borrowRate,
            poolConstants.loanStartTime,
            poolConstants.borrowAsset
        );
        IExtension(_poolFactory.extension()).initializePoolExtension(_repaymentInterval);
        SavingsAccountUtil.transferTokens(poolConstants.borrowAsset, _tokensLent, address(this), msg.sender);

        delete poolConstants.loanWithdrawalDeadline;
        emit AmountBorrowed(_tokensLent);
    }

    function _withdrawAllCollateral(address _receiver, uint256 _penality) internal {
        address _poolSavingsStrategy = poolConstants.poolSavingsStrategy;
        address _collateralAsset = poolConstants.collateralAsset;
        uint256 _collateralShares = poolVars.baseLiquidityShares.add(poolVars.extraLiquidityShares).sub(_penality);
        uint256 _collateralTokens = _collateralShares;
        if (_poolSavingsStrategy != address(0)) {
            _collateralTokens = IYield(_poolSavingsStrategy).getTokensForShares(_collateralShares, _collateralAsset);
        }

        uint256 _sharesReceived;
        if (_collateralShares != 0) {
            ISavingsAccount _savingsAccount = ISavingsAccount(IPoolFactory(PoolFactory).savingsAccount());
            _sharesReceived = SavingsAccountUtil.savingsAccountTransfer(
                _savingsAccount,
                address(this),
                _receiver,
                _collateralTokens,
                _collateralAsset,
                _poolSavingsStrategy
            );
        }
        emit CollateralWithdrawn(_receiver, _sharesReceived);
        poolVars.baseLiquidityShares = _penality;
        delete poolVars.extraLiquidityShares;
    }

    function lend(
        address _lender,
        uint256 _amountLent,
        bool _fromSavingsAccount
    ) external payable nonReentrant {
        require(poolVars.loanStatus == LoanStatus.COLLECTION, '15');
        require(block.timestamp < poolConstants.loanStartTime, '16');
        uint256 _amount = _amountLent;
        uint256 _borrowAmountNeeded = poolConstants.borrowAmountRequested;
        uint256 _lentAmount = poolToken.totalSupply();
        if (_amountLent.add(_lentAmount) > _borrowAmountNeeded) {
            _amount = _borrowAmountNeeded.sub(_lentAmount);
        }

        address _borrowToken = poolConstants.borrowAsset;
        _deposit(_fromSavingsAccount, false, _borrowToken, _amount, address(0), msg.sender, address(this));
        poolToken.mint(_lender, _amount);
        emit LiquiditySupplied(_amount, _lender);
    }

    function beforeTransfer(
        address _from,
        address _to,
        uint256 _amount
    ) public override {
        require(msg.sender == address(poolToken));
        require(getMarginCallEndTime(_from) == 0, '18');
        require(getMarginCallEndTime(_to) == 0, '19');

        //Withdraw repayments for user
        _withdrawRepayment(_from);
        _withdrawRepayment(_to);

        //transfer extra liquidity shares
        uint256 _liquidityShare = lenders[_from].extraLiquidityShares;
        if (_liquidityShare == 0) return;

        uint256 toTransfer = _liquidityShare;
        if (_amount != poolToken.balanceOf(_from)) {
            toTransfer = (_amount.mul(_liquidityShare)).div(poolToken.balanceOf(_from));
        }

        lenders[_from].extraLiquidityShares = lenders[_from].extraLiquidityShares.sub(toTransfer);

        lenders[_to].extraLiquidityShares = lenders[_to].extraLiquidityShares.add(toTransfer);
    }

    function cancelPool() external {
        LoanStatus _poolStatus = poolVars.loanStatus;
        require(_poolStatus == LoanStatus.COLLECTION, 'CP1');

        if (poolConstants.loanStartTime < block.timestamp && poolToken.totalSupply() < poolConstants.minborrowAmount) {
            return _cancelPool(0);
        }

        if (poolConstants.loanWithdrawalDeadline > block.timestamp) {
            require(msg.sender == poolConstants.borrower, 'CP2');
        }
        // note: extra liquidity shares are not applicable as the loan never reaches active state
        uint256 _collateralLiquidityShare = poolVars.baseLiquidityShares;
        uint256 penality =
            IPoolFactory(PoolFactory)
                .poolCancelPenalityFraction()
                .mul(_collateralLiquidityShare)
                .mul(poolToken.totalSupply())
                .div(poolConstants.borrowAmountRequested)
                .div(10**30);
        _cancelPool(penality);
    }

    function _cancelPool(uint256 _penality) internal {
        poolVars.loanStatus = LoanStatus.CANCELLED;
        IExtension(IPoolFactory(PoolFactory).extension()).closePoolExtension();
        _withdrawAllCollateral(poolConstants.borrower, _penality);
        poolToken.pause();
        emit OpenBorrowPoolCancelled();
    }

    // Note: _receiveLiquidityShares doesn't matter when _toSavingsAccount is true
    function liquidateCancelPenality(bool _toSavingsAccount, bool _receiveLiquidityShare) external {
        require(poolVars.loanStatus == LoanStatus.CANCELLED, '');
        require(poolVars.penalityLiquidityAmount == 0, '');
        address _poolFactory = PoolFactory;
        address _poolSavingsStrategy = poolConstants.poolSavingsStrategy;
        address _collateralAsset = poolConstants.collateralAsset;
        // note: extra liquidity shares are not applicable as the loan never reaches active state
        uint256 _collateralTokens = poolVars.baseLiquidityShares;
        if (_poolSavingsStrategy != address(0)) {
            _collateralTokens = IYield(_poolSavingsStrategy).getTokensForShares(_collateralTokens, _collateralAsset);
        }
        uint256 _liquidationTokens =
            correspondingBorrowTokens(
                _collateralTokens,
                _poolFactory,
                IPoolFactory(_poolFactory).liquidatorRewardFraction()
            );
        SavingsAccountUtil.transferTokens(poolConstants.borrowAsset, _liquidationTokens, msg.sender, address(this));
        poolVars.penalityLiquidityAmount = _liquidationTokens;
        _withdraw(
            _toSavingsAccount,
            _receiveLiquidityShare,
            poolConstants.collateralAsset,
            poolConstants.poolSavingsStrategy,
            _collateralTokens
        );
    }

    function terminateOpenBorrowPool() external onlyOwner {
        _withdrawAllCollateral(msg.sender, 0);
        poolToken.pause();
        poolVars.loanStatus = LoanStatus.TERMINATED;
        IExtension(IPoolFactory(PoolFactory).extension()).closePoolExtension();
        emit OpenBorrowPoolTerminated();
    }

    function closeLoan() external payable override OnlyRepaymentImpl {
        require(poolVars.loanStatus == LoanStatus.ACTIVE, '22');

        uint256 _principalToPayback = poolToken.totalSupply();
        address _borrowAsset = poolConstants.borrowAsset;

        SavingsAccountUtil.transferTokens(_borrowAsset, _principalToPayback, msg.sender, address(this));

        poolVars.loanStatus = LoanStatus.CLOSED;

        IExtension(IPoolFactory(PoolFactory).extension()).closePoolExtension();
        _withdrawAllCollateral(msg.sender, 0);
        poolToken.pause();

        emit OpenBorrowPoolClosed();
    }

    // Note - Only when closed, cancelled or terminated, lender can withdraw
    //burns all shares and returns total remaining repayments along with provided liquidity
    function withdrawLiquidity() external isLender(msg.sender) nonReentrant {
        LoanStatus _loanStatus = poolVars.loanStatus;

        require(
            _loanStatus == LoanStatus.CLOSED ||
                _loanStatus == LoanStatus.CANCELLED ||
                _loanStatus == LoanStatus.DEFAULTED,
            '24'
        );

        //get total repayments collected as per loan status (for closed, it returns 0)
        // uint256 _due = calculateRepaymentWithdrawable(msg.sender);

        //gets amount through liquidity shares
        uint256 _actualBalance = poolToken.balanceOf(msg.sender);
        uint256 _toTransfer = _actualBalance;

        if (_loanStatus == LoanStatus.DEFAULTED) {
            uint256 _totalAsset;
            if (poolConstants.borrowAsset != address(0)) {
                _totalAsset = IERC20(poolConstants.borrowAsset).balanceOf(address(this));
            } else {
                _totalAsset = address(this).balance;
            }

            //assuming their will be no tokens in pool in any case except liquidation (to be checked) or we should store the amount in liquidate()
            _toTransfer = _toTransfer.mul(_totalAsset).div(poolToken.totalSupply());
        }

        if (_loanStatus == LoanStatus.CANCELLED) {
            _toTransfer = _toTransfer.add(
                _toTransfer.mul(poolVars.penalityLiquidityAmount).div(poolToken.totalSupply())
            );
        }

        // _due = _balance.add(_due);

        // lenders[msg.sender].amountWithdrawn = lenders[msg.sender]
        //     .amountWithdrawn
        //     .add(_due);
        delete lenders[msg.sender].principalWithdrawn;

        //transfer repayment
        _withdrawRepayment(msg.sender);
        //to add transfer if not included in above (can be transferred with liquidity)
        poolToken.burn(msg.sender, _actualBalance);
        //transfer liquidity provided
        SavingsAccountUtil.transferTokens(poolConstants.borrowAsset, _toTransfer, address(this), msg.sender);

        // TODO: Something wrong in the below event. Please have a look
        emit LiquidityWithdrawn(_toTransfer, msg.sender);
    }

    /**
     * @dev This function is executed by lender to exercise margin call
     * @dev It will revert in case collateral ratio is not below expected value
     * or the lender has already called it.
     */

    function requestMarginCall() external isLender(msg.sender) {
        require(poolVars.loanStatus == LoanStatus.ACTIVE, '4');

        IPoolFactory _poolFactory = IPoolFactory(PoolFactory);
        require(getMarginCallEndTime(msg.sender) != 0, 'RMC1');
        require(
            poolConstants.idealCollateralRatio >
                getCurrentCollateralRatio(msg.sender).add(_poolFactory.collateralVolatilityThreshold()),
            '26'
        );

        lenders[msg.sender].marginCallEndTime = block.timestamp.add(_poolFactory.marginCallDuration());

        emit MarginCalled(msg.sender);
    }

    // function transferRepayImpl(address repayment) external onlyOwner {}

    // function transferLenderImpl(address lenderImpl) external onlyOwner {
    //     require(lenderImpl != address(0), "Borrower: Lender address");
    //     _lender = lenderImpl;
    // }

    // event PoolLiquidated(bytes32 poolHash, address liquidator, uint256 amount);
    // //todo: add more details here
    // event Liquidated(address liquidator, address lender);

    // function amountPerPeriod() public view returns (uint256) {}

    function interestTillNow(uint256 _balance) public view returns (uint256) {
        uint256 _totalSupply = poolToken.totalSupply();
        uint256 _interestPerPeriod = interestPerPeriod(_balance);
        IPoolFactory _poolFactory = IPoolFactory(PoolFactory);
        (uint256 _loanDurationCovered, uint256 _interestPerSecond) =
            IRepayment(_poolFactory.repaymentImpl()).getInterestCalculationVars(address(this));
        uint256 _currentBlockTime = block.timestamp.mul(10**30);
        uint256 _interestAccrued = _interestPerSecond.mul(_currentBlockTime.sub(_loanDurationCovered)).div(10**30);

        return _interestAccrued;
    }

    function calculateCollateralRatio(uint256 _balance, uint256 _liquidityShares) public returns (uint256 _ratio) {
        uint256 _interest = interestTillNow(_balance);
        address _collateralAsset = poolConstants.collateralAsset;

        address _strategy = poolConstants.poolSavingsStrategy;
        uint256 _currentCollateralTokens =
            _strategy == address(0)
                ? _liquidityShares
                : IYield(_strategy).getTokensForShares(_liquidityShares, _collateralAsset);
        uint256 _equivalentCollateral =
            getEquivalentTokens(_collateralAsset, poolConstants.borrowAsset, _currentCollateralTokens);
        _ratio = _equivalentCollateral.mul(10**30).div(_balance.add(_interest));
    }

    function getCurrentCollateralRatio() public returns (uint256 _ratio) {
        uint256 _liquidityShares = poolVars.baseLiquidityShares.add(poolVars.extraLiquidityShares);

        _ratio = calculateCollateralRatio(poolToken.totalSupply(), _liquidityShares);
    }

    function getCurrentCollateralRatio(address _lender) public returns (uint256 _ratio) {
        uint256 _balanceOfLender = poolToken.balanceOf(_lender);
        uint256 _liquidityShares =
            (poolVars.baseLiquidityShares.mul(_balanceOfLender).div(poolToken.totalSupply())).add(
                lenders[_lender].extraLiquidityShares
            );

        return (calculateCollateralRatio(_balanceOfLender, _liquidityShares));
    }

    function liquidatePool(
        bool _fromSavingsAccount,
        bool _toSavingsAccount,
        bool _recieveLiquidityShare
    ) external payable nonReentrant {
        LoanStatus _currentPoolStatus = poolVars.loanStatus;
        address _poolFactory = PoolFactory;
        if (
            _currentPoolStatus != LoanStatus.DEFAULTED &&
            IRepayment(IPoolFactory(_poolFactory).repaymentImpl()).didBorrowerDefault(address(this))
        ) {
            _currentPoolStatus = LoanStatus.DEFAULTED;
            poolVars.loanStatus = _currentPoolStatus;
        }
        require(_currentPoolStatus == LoanStatus.DEFAULTED, 'Pool::liquidatePool - No reason to liquidate the pool');

        address _collateralAsset = poolConstants.collateralAsset;
        address _borrowAsset = poolConstants.borrowAsset;
        uint256 _collateralLiquidityShare = poolVars.baseLiquidityShares.add(poolVars.extraLiquidityShares);
        address _poolSavingsStrategy = poolConstants.poolSavingsStrategy;

        uint256 _collateralTokens = _collateralLiquidityShare;
        if (_poolSavingsStrategy != address(0)) {
            _collateralTokens = IYield(_poolSavingsStrategy).getTokensForShares(
                _collateralLiquidityShare,
                _collateralAsset
            );
        }

        uint256 _poolBorrowTokens =
            correspondingBorrowTokens(
                _collateralTokens,
                _poolFactory,
                IPoolFactory(_poolFactory).liquidatorRewardFraction()
            );

        _deposit(_fromSavingsAccount, false, _borrowAsset, _poolBorrowTokens, address(0), msg.sender, address(this));

        _withdraw(_toSavingsAccount, _recieveLiquidityShare, _collateralAsset, _poolSavingsStrategy, _collateralTokens);

        delete poolVars.extraLiquidityShares;
        delete poolVars.baseLiquidityShares;
        emit PoolLiquidated(msg.sender);
    }

    function _withdraw(
        bool _toSavingsAccount,
        bool _recieveLiquidityShare,
        address _asset,
        address _poolSavingsStrategy,
        uint256 _amountInTokens
    ) internal returns (uint256) {
        ISavingsAccount _savingsAccount = ISavingsAccount(IPoolFactory(PoolFactory).savingsAccount());
        return
            SavingsAccountUtil.depositFromSavingsAccount(
                _savingsAccount,
                address(this),
                msg.sender,
                _amountInTokens,
                _asset,
                _poolSavingsStrategy,
                _recieveLiquidityShare,
                _toSavingsAccount
            );
    }

    function _canLenderBeLiquidated(address _lender) internal {
        require(
            (poolVars.loanStatus == LoanStatus.ACTIVE) && (block.timestamp > poolConstants.loanWithdrawalDeadline),
            '27'
        );
        uint256 _marginCallEndTime = lenders[_lender].marginCallEndTime;
        require(getMarginCallEndTime(_lender) != 0, 'No margin call has been called.');
        require(_marginCallEndTime < block.timestamp, '28');

        require(
            poolConstants.idealCollateralRatio.sub(IPoolFactory(PoolFactory).collateralVolatilityThreshold()) >
                getCurrentCollateralRatio(_lender),
            '29'
        );
        require(poolToken.balanceOf(_lender) != 0, '30');
    }

    function updateLenderSharesDuringLiquidation(address _lender)
        internal
        returns (uint256 _lenderCollateralLPShare, uint256 _lenderBalance)
    {
        uint256 _poolBaseLPShares = poolVars.baseLiquidityShares;
        _lenderBalance = poolToken.balanceOf(_lender);

        uint256 _lenderBaseLPShares = (_poolBaseLPShares.mul(_lenderBalance)).div(poolToken.totalSupply());
        uint256 _lenderExtraLPShares = lenders[_lender].extraLiquidityShares;
        poolVars.baseLiquidityShares = _poolBaseLPShares.sub(_lenderBaseLPShares);
        poolVars.extraLiquidityShares = poolVars.extraLiquidityShares.sub(_lenderExtraLPShares);

        _lenderCollateralLPShare = _lenderBaseLPShares.add(_lenderExtraLPShares);
    }

    function _liquidateLender(
        bool _fromSavingsAccount,
        address _lender,
        uint256 _lenderCollateralTokens
    ) internal {
        address _poolSavingsStrategy = poolConstants.poolSavingsStrategy;

        address _poolFactory = PoolFactory;
        uint256 _lenderLiquidationTokens =
            correspondingBorrowTokens(
                _lenderCollateralTokens,
                _poolFactory,
                IPoolFactory(_poolFactory).liquidatorRewardFraction()
            );

        address _borrowAsset = poolConstants.borrowAsset;
        _deposit(
            _fromSavingsAccount,
            false,
            _borrowAsset,
            _lenderLiquidationTokens,
            _poolSavingsStrategy,
            msg.sender,
            _lender
        );

        _withdrawRepayment(_lender);
    }

    function liquidateLender(
        address _lender,
        bool _fromSavingsAccount,
        bool _toSavingsAccount,
        bool _recieveLiquidityShare
    ) public payable nonReentrant {
        _canLenderBeLiquidated(_lender);

        address _poolSavingsStrategy = poolConstants.poolSavingsStrategy;
        (uint256 _lenderCollateralLPShare, uint256 _lenderBalance) = updateLenderSharesDuringLiquidation(_lender);

        uint256 _lenderCollateralTokens = _lenderCollateralLPShare;
        if (_poolSavingsStrategy != address(0)) {
            _lenderCollateralTokens = IYield(_poolSavingsStrategy).getTokensForShares(
                _lenderCollateralLPShare,
                poolConstants.collateralAsset
            );
        }

        _liquidateLender(_fromSavingsAccount, _lender, _lenderCollateralTokens);

        uint256 _amountReceived =
            _withdraw(
                _toSavingsAccount,
                _recieveLiquidityShare,
                poolConstants.collateralAsset,
                _poolSavingsStrategy,
                _lenderCollateralTokens
            );
        poolToken.burn(_lender, _lenderBalance);
        delete lenders[_lender];
        emit LenderLiquidated(msg.sender, _lender, _amountReceived);
    }

    function correspondingBorrowTokens(
        uint256 _totalCollateralTokens,
        address _poolFactory,
        uint256 _fraction
    ) public view returns (uint256) {
        IPoolFactory _PoolFactory = IPoolFactory(_poolFactory);
        (uint256 _ratioOfPrices, uint256 _decimals) =
            IPriceOracle(_PoolFactory.priceOracle()).getLatestPrice(
                poolConstants.collateralAsset,
                poolConstants.borrowAsset
            );
        return
            _totalCollateralTokens.mul(_ratioOfPrices).mul(uint256(10**30).sub(_fraction)).div(10**_decimals).div(
                10**30
            );
    }

    function interestPerSecond(uint256 _principal) public view returns (uint256) {
        uint256 _interest = ((_principal).mul(poolConstants.borrowRate)).div(365 days);
        return _interest;
    }

    function interestPerPeriod(uint256 _balance) public view returns (uint256) {
        return (interestPerSecond(_balance).mul(poolConstants.repaymentInterval));
    }

    function calculateCurrentPeriod() public view returns (uint256) {
        uint256 _currentPeriod =
            (block.timestamp.sub(poolConstants.loanStartTime, '34')).div(poolConstants.repaymentInterval);
        return _currentPeriod;
    }

    function calculateRepaymentWithdrawable(address _lender) internal view returns (uint256) {
        uint256 _totalRepaidAmount =
            IRepayment(IPoolFactory(PoolFactory).repaymentImpl()).getTotalRepaidAmount(address(this));

        uint256 _amountWithdrawable =
            (poolToken.balanceOf(_lender).mul(_totalRepaidAmount).div(poolToken.totalSupply())).sub(
                lenders[_lender].interestWithdrawn
            );

        return _amountWithdrawable;
    }

    // Withdraw Repayment, Also all the extra state variables are added here only for the review

    function withdrawRepayment() external isLender(msg.sender) {
        _withdrawRepayment(msg.sender);
    }

    function _withdrawRepayment(address _lender) internal {
        uint256 _amountToWithdraw = calculateRepaymentWithdrawable(_lender);

        if (_amountToWithdraw == 0) {
            return;
        }

        SavingsAccountUtil.transferTokens(poolConstants.borrowAsset, _amountToWithdraw, address(this), _lender);

        lenders[_lender].interestWithdrawn = lenders[_lender].interestWithdrawn.add(_amountToWithdraw);
    }

    function getMarginCallEndTime(address _lender) public view override returns (uint256) {
        uint256 _marginCallDuration = IPoolFactory(PoolFactory).marginCallDuration();
        uint256 _marginCallEndTime = lenders[_lender].marginCallEndTime;
        if (block.timestamp > _marginCallEndTime.add(_marginCallDuration.mul(2))) {
            _marginCallEndTime = 0;
        }
        return _marginCallEndTime;
    }

    function getTotalSupply() public view override returns (uint256) {
        return poolToken.totalSupply();
    }

    function getBalanceDetails(address _lender) public view override returns (uint256, uint256) {
        IPoolToken _poolToken = poolToken;
        return (_poolToken.balanceOf(_lender), _poolToken.totalSupply());
    }

    /*function updateNextDuePeriodAfterRepayment(uint256 _nextDuePeriod) 
        external 
        override 
        returns (uint256)
    {
        require(msg.sender == IPoolFactory(PoolFactory).repaymentImpl(), "37");
        poolVars.nextDuePeriod = _nextDuePeriod;
    }*/

    /*
    function grantExtension()
        external
        override
        onlyExtension
        returns (uint256)
    {
        uint256 _nextDuePeriod = poolVars.nextDuePeriod.add(1);
        poolVars.nextDuePeriod = _nextDuePeriod;
        return _nextDuePeriod;
    }
    */
    /*function updateNextRepaymentPeriodAfterExtension()
        external 
        override 
        returns (uint256)
    {
        require(msg.sender == IPoolFactory(PoolFactory).extension(), "38");
        uint256 _nextRepaymentPeriod = poolVars.nextDuePeriod.add(10**30);
        poolVars.nextRepaymentPeriod = _nextDuePeriod;
        return _nextDuePeriod;
    }*/

    function getLoanStatus() public view override returns (uint256) {
        return uint256(poolVars.loanStatus);
    }

    receive() external payable {
        require(msg.sender == IPoolFactory(PoolFactory).savingsAccount(), '35');
    }

    function getEquivalentTokens(
        address _source,
        address _target,
        uint256 _amount
    ) public view returns (uint256) {
        (uint256 _price, uint256 _decimals) =
            IPriceOracle(IPoolFactory(PoolFactory).priceOracle()).getLatestPrice(_source, _target);
        return _amount.mul(_price).div(10**_decimals);
    }

    function borrower() external view override returns (address) {
        return poolConstants.borrower;
    }
}
