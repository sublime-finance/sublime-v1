// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;

import '../Proxy.sol';
import '../interfaces/IPoolFactory.sol';
import '../interfaces/IVerification.sol';
import '../interfaces/IStrategyRegistry.sol';
import '../interfaces/IRepayment.sol';
import '../interfaces/IPriceOracle.sol';
import './PoolToken.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';

contract PoolFactory is Initializable, OwnableUpgradeable, IPoolFactory {
    bytes32 public constant MINTER_ROLE = keccak256('MINTER_ROLE');
    bytes32 public constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    /*
     * @notice Used to define limits for the Open Borrow Pool parameters
     * @param min the minimum threshold for the parameter
     * @param max the maximum threshold for the parameter
     */
    struct Limits {
        // TODO: Optimize to uint128 or even less
        uint256 min;
        uint256 max;
    }

    // TODO contract addresses should end with Impl
    bytes4 public poolInitFuncSelector; //  bytes4(keccak256("initialize(uint256,address,address,address,uint256,uint256,uint256,uint256,bool)"))
    bytes4 public poolTokenInitFuncSelector;
    address public poolImpl;
    address public poolTokenImpl;
    address public userRegistry;
    address public strategyRegistry;
    address public override extension;
    address public override repaymentImpl;
    address public override priceOracle;
    address public override savingsAccount;

    uint256 public override collectionPeriod;
    uint256 public override matchCollateralRatioInterval;
    uint256 public override marginCallDuration;
    uint256 public override collateralVolatilityThreshold;
    uint256 public override gracePeriodPenaltyFraction;
    uint256 public override liquidatorRewardFraction;
    uint256 public override votingPassRatio;
    uint256 public override poolCancelPenalityFraction;

    /*
     * @notice Used to mark assets supported for borrowing
     */
    mapping(address => bool) isBorrowToken;

    /*
     * @notice Used to mark supported collateral assets
     */
    mapping(address => bool) isCollateralToken;

    /*
     * @notice Used to keep track of valid pool addresses
     */
    mapping(address => bool) public override openBorrowPoolRegistry;

    /*
     * @notice Used to set the min/max borrow amount for Open Borrow Pools
     */
    Limits poolSizeLimit;

    /*
     * @notice Used to set the min/max collateral ratio for Open Borrow Pools
     */
    Limits collateralRatioLimit;

    /*
     * @notice Used to set the min/max borrow rates (interest rate provided by borrower) for Open Borrow Pools
     */
    Limits borrowRateLimit;

    /*
     * @notice used to set the min/max repayment interval for Open Borrow Pools
     */
    Limits repaymentIntervalLimit;

    /*
     * @notice used to set the min/max number of repayment intervals for Open Borrow Pools
     */
    Limits noOfRepaymentIntervalsLimit;

    /*
     * @notice emitted when a Open Borrow Pool is created
     * @param pool the address of the Open Borrow Pool
     * @param borrower the address of the borrower who created the pool
     * @param poolToken the address of the corresponding pool token for the Open Borrow Pool
     */
    event PoolCreated(address pool, address borrower, address poolToken);

    event PoolInitSelectorUpdated(bytes4 updatedSelector);
    event PoolTokenInitFuncSelector(bytes4 updatedSelector);

    /*
     * @notice emitted when the Pool.sol logic is updated
     * @param updatedPoolLogic the address of the new Pool logic contract
     */
    event PoolLogicUpdated(address updatedPoolLogic);

    /*
     * @notice emitted when the user registry is updated
     * @param updatedBorrowerRegistry address of the contract storing the user registry
     */
    event UserRegistryUpdated(address updatedBorrowerRegistry);

    /*
     * @notice emitted when the strategy registry is updated
     * @param updatedStrategyRegistry address of the contract storing the updated strategy registry
     */
    event StrategyRegistryUpdated(address updatedStrategyRegistry);

    /*
     * @notice emitted when the Repayments.sol logic is updated
     * @param updatedRepaymentImpl the address of the new implementation of the Repayments logic
     */
    event RepaymentImplUpdated(address updatedRepaymentImpl);

    /*
     * @notice emitted when the PoolToken.sol logic is updated
     * @param updatedPoolTokenImpl address of the new implementation of the PoolToken logic
     */
    event PoolTokenImplUpdated(address updatedPoolTokenImpl);

    /*
     * @notice emitted when the PriceOracle.sol is updated
     * @param updatedPriceOracle address of the new implementation of the PriceOracle
     */
    event PriceOracleUpdated(address updatedPriceOracle);

    /*
     * @notice emitted when the Extension.sol is updated
     * @param updatedExtension address of the new implementation of the Extension
     */
    event ExtensionImplUpdated(address updatedExtension);

    /*
     * @notice emitted when the SavingsAccount.sol is updated
     * @param savingsAccount address of the new implementation of the SavingsAccount
     */
    event SavingsAccountUpdated(address savingsAccount);

    /*
     * @notice emitted when the collection period parameter for Open Borrow Pools is updated
     * @param updatedCollectionPeriod the new value of the collection period for Open Borrow Pools
     */
    event CollectionPeriodUpdated(uint256 updatedCollectionPeriod);

    event MatchCollateralRatioIntervalUpdated(uint256 updatedMatchCollateralRatioInterval);

    /*
     * @notice emitted when the marginCallDuration variable is updated
     * @param updatedMarginCallDuration Duration (in seconds) for which a margin call is active
     */
    event MarginCallDurationUpdated(uint256 updatedMarginCallDuration);

    /*
     * @notice emitted when collateralVolatilityThreshold variable is updated
     * @param updatedCollateralVolatilityThreshold Updated value of collateralVolatilityThreshold
     */
    event CollateralVolatilityThresholdUpdated(uint256 updatedCollateralVolatilityThreshold);

    /*
     * @notice emitted when gracePeriodPenaltyFraction variable is updated
     * @param updatedGracePeriodPenaltyFraction updated value of gracePeriodPenaltyFraction
     */
    event GracePeriodPenaltyFractionUpdated(uint256 updatedGracePeriodPenaltyFraction);

    /*
     * @notice emitted when liquidatorRewardFraction variable is updated
     * @param updatedLiquidatorRewardFraction updated value of liquidatorRewardFraction
     */
    event LiquidatorRewardFractionUpdated(uint256 updatedLiquidatorRewardFraction);

    /*
     * @notice emitted when poolCancelPenalityFraction variable is updated
     * @param updatedPoolCancelPenalityFraction updated value of poolCancelPenalityFraction
     */
    event PoolCancelPenalityFractionUpdated(uint256 updatedPoolCancelPenalityFraction);

    /*
     * @notice emitted when threhsolds for one of the parameters (poolSizeLimit, collateralRatioLimit, borrowRateLimit, repaymentIntervalLimit, noOfRepaymentIntervalsLimit) is updated
     * @param limitType specifies the parameter whose limits are being updated
     * @param max maximum threshold value for limitType
     * @param min minimum threshold value for limitType
     */
    event LimitsUpdated(string limitType, uint256 max, uint256 min);

    /*
     * @notice emitted when the list of supported borrow assets is updated
     * @param borrowToken address of the borrow asset
     * @param isSupported true if borrowToken is a valid borrow asset, false if borrowToken is an invalid borrow asset
     */
    event BorrowTokenUpdated(address borrowToken, bool isSupported);

    /*
     * @notice emitted when the list of supported collateral assets is updated
     * @param collateralToken address of the collateral asset
     * @param isSupported true if collateralToken is a valid collateral asset, false if collateralToken is an invalid collateral asset
     */
    event CollateralTokenUpdated(address collateralToken, bool isSupported);

    /*
     * @notice functions affected by this modifier can only be invoked by the Pool
     */
    modifier onlyPool() {
        require(openBorrowPoolRegistry[msg.sender], 'PoolFactory::onlyPool - Only pool can destroy itself');
        _;
    }

    /*
     * @notice functions affected by this modifier can only be invoked by the borrow of the Pool
     */
    modifier onlyBorrower() {
        require(
            IVerification(userRegistry).isUser(msg.sender),
            'PoolFactory::onlyBorrower - Only a valid Borrower can create Pool'
        );
        _;
    }

    /*
     * @notice returns the owner of the pool
     */
    function owner() public view override(IPoolFactory, OwnableUpgradeable) returns (address) {
        return OwnableUpgradeable.owner();
    }

    /*
     * @notice invoked during deployment
     * @param _userRegistry
     * @param _strategyRegistry
     * @param _admin
     * @param _collectionPeriod
     * @param _matchCollateralRatioInterval
     * @param _marginCallDuration
     * @param _collateralVolatilityThreshold
     * @param _gracePeriodPenaltyFraction
     * @param _poolInitFuncSelector
     * @param _poolTokenInitFuncSelector
     * @param _liquidatorRewardFraction
     * @param _priceOracle
     * @param _savingsAccount
     * @param _extension
     * @param _poolCancelPenaltyFraction
     */

    function initialize(
        address _admin,
        uint256 _collectionPeriod,
        uint256 _matchCollateralRatioInterval,
        uint256 _marginCallDuration,
        uint256 _collateralVolatilityThreshold,
        uint256 _gracePeriodPenaltyFraction,
        bytes4 _poolInitFuncSelector,
        bytes4 _poolTokenInitFuncSelector,
        uint256 _liquidatorRewardFraction,
        uint256 _poolCancelPenalityFraction
    ) external initializer {
        {
            OwnableUpgradeable.__Ownable_init();
            OwnableUpgradeable.transferOwnership(_admin);
        }
        _updateCollectionPeriod(_collectionPeriod);
        _updateMatchCollateralRatioInterval(_matchCollateralRatioInterval);
        _updateMarginCallDuration(_marginCallDuration);
        _updateCollateralVolatilityThreshold(_collateralVolatilityThreshold);
        _updateGracePeriodPenaltyFraction(_gracePeriodPenaltyFraction);
        _updatepoolInitFuncSelector(_poolInitFuncSelector);
        _updatePoolTokenInitFuncSelector(_poolTokenInitFuncSelector);
        _updateLiquidatorRewardFraction(_liquidatorRewardFraction);
        _updatePoolCancelPenalityFraction(_poolCancelPenalityFraction);
    }

    /*
     * @notice invoked by admin to update logic for pool, repayment, and pool token contracts
     * @param _poolImpl Address of new pool contract
     * @param _repaymentImpl Address of new repayment contract
     * @param _poolTokenImpl address of new pool token contract
     */
    function setImplementations(
        address _poolImpl,
        address _repaymentImpl,
        address _poolTokenImpl,
        address _userRegistry,
        address _strategyRegistry,
        address _priceOracle,
        address _savingsAccount,
        address _extension
    ) external onlyOwner {
        _updatePoolLogic(_poolImpl);
        _updateRepaymentImpl(_repaymentImpl);
        _updatePoolTokenImpl(_poolTokenImpl);
        _updateSavingsAccount(_savingsAccount);
        _updatedExtension(_extension);
        _updateUserRegistry(_userRegistry);
        _updateStrategyRegistry(_strategyRegistry);
        _updatePriceoracle(_priceOracle);
    }

    // check _collateralAmount
    // check _salt
    /*
     * @notice invoked when a new borrow pool is created. deploys a new pool for every borrow request
     * @param _poolSize loan amount requested
     * @param _minBorrowAmount minimum borrow amount for the loan to become active - expressed as a fraction of _poolSize
     * @param _borrowTokenType borrow asset requested
     * @param _collateralTokenType collateral asset requested
     * @param _collateralRatio ideal pool collateral ratio set by the borrower
     * @param _borrowRate interest rate provided by the borrower
     * @param _repaymentInterval interval between the last dates of two repayment cycles
     * @param _noOfRepaymentIntervals number of repayments to be made during the duration of the loan
     * @param _poolSavingsStrategy savings strategy selected for the pool collateral
     * @param _collateralAmount collateral amount deposited
     * @param _transferFromSavingsAccount if true, initial collateral is transferred from borrower's savings account, if false, borrower transfers initial collateral deposit from wallet
     * @param _salt
     */
    function createPool(
        uint256 _poolSize,
        uint256 _minBorrowAmount,
        address _borrowTokenType,
        address _collateralTokenType,
        uint256 _collateralRatio,
        uint256 _borrowRate,
        uint256 _repaymentInterval,
        uint256 _noOfRepaymentIntervals,
        address _poolSavingsStrategy,
        uint256 _collateralAmount,
        bool _transferFromSavingsAccount,
        bytes32 _salt
    ) external payable onlyBorrower {
        require(_minBorrowAmount <= _poolSize, 'PoolFactory::createPool - invalid min borrow amount');
        require(collateralVolatilityThreshold <= _collateralRatio, 'PoolFactory:createPool - Invalid collateral ratio');
        require(isBorrowToken[_borrowTokenType], 'PoolFactory::createPool - Invalid borrow token type');
        require(isCollateralToken[_collateralTokenType], 'PoolFactory::createPool - Invalid collateral token type');
        address[] memory tokens = new address[](2);
        tokens[0] = _collateralTokenType;
        tokens[1] = _borrowTokenType;
        require(
            IPriceOracle(priceOracle).doesFeedExist(tokens),
            "PoolFactory::createPool - Price feed doesn't support token pair"
        );
        require(
            IStrategyRegistry(strategyRegistry).registry(_poolSavingsStrategy),
            'PoolFactory::createPool - Invalid strategy'
        );
        require(
            isWithinLimits(_poolSize, poolSizeLimit.min, poolSizeLimit.max),
            'PoolFactory::createPool - PoolSize not within limits'
        );
        require(
            isWithinLimits(_collateralRatio, collateralRatioLimit.min, collateralRatioLimit.max),
            'PoolFactory::createPool - Collateral Ratio not within limits'
        );
        require(
            isWithinLimits(_borrowRate, borrowRateLimit.min, borrowRateLimit.max),
            'PoolFactory::createPool - Borrow rate not within limits'
        );
        require(
            isWithinLimits(_noOfRepaymentIntervals, noOfRepaymentIntervalsLimit.min, noOfRepaymentIntervalsLimit.max),
            'PoolFactory::createPool - Loan duration not within limits'
        );
        require(
            isWithinLimits(_repaymentInterval, repaymentIntervalLimit.min, repaymentIntervalLimit.max),
            'PoolFactory::createPool - Repayment interval not within limits'
        );
        bytes memory data =
            abi.encodeWithSelector(
                poolInitFuncSelector,
                _poolSize,
                _minBorrowAmount,
                msg.sender,
                _borrowTokenType,
                _collateralTokenType,
                _collateralRatio,
                _borrowRate,
                _repaymentInterval,
                _noOfRepaymentIntervals,
                _poolSavingsStrategy,
                _collateralAmount,
                _transferFromSavingsAccount,
                matchCollateralRatioInterval,
                collectionPeriod
            );

        bytes32 salt = keccak256(abi.encodePacked(_salt, msg.sender));
        bytes memory bytecode =
            abi.encodePacked(type(SublimeProxy).creationCode, abi.encode(poolImpl, address(0x01), data));
        uint256 amount = _collateralTokenType == address(0) ? _collateralAmount : 0;

        address pool = _deploy(amount, salt, bytecode);

        bytes memory tokenData =
            abi.encodeWithSelector(poolTokenInitFuncSelector, 'Open Borrow Pool Tokens', 'OBPT', pool);
        address poolToken = address(new SublimeProxy(poolTokenImpl, address(0), tokenData));
        IPool(pool).setPoolToken(poolToken);
        openBorrowPoolRegistry[pool] = true;
        emit PoolCreated(pool, msg.sender, poolToken);
    }

    /**
     * @dev Deploys a contract using `CREATE2`. The address where the contract
     * will be deployed can be known in advance via {computeAddress}.
     *
     * The bytecode for a contract can be obtained from Solidity with
     * `type(contractName).creationCode`.
     *
     * Requirements:
     *
     * - `bytecode` must not be empty.
     * - `salt` must have not been used for `bytecode` already.
     * - the factory must have a balance of at least `amount`.
     * - if `amount` is non-zero, `bytecode` must have a `payable` constructor.
     */
    function _deploy(
        uint256 amount,
        bytes32 salt,
        bytes memory bytecode
    ) internal returns (address addr) {
        require(bytecode.length != 0, 'Create2: bytecode length is zero');
        // solhint-disable-next-line no-inline-assembly
        assembly {
            addr := create2(amount, add(bytecode, 0x20), mload(bytecode), salt)
        }
        require(addr != address(0), 'Create2: Failed on deploy');
    }

    /*
     * @notice invoked to check if pool parameters are within thresholds
     * @param _value supplied value of the parameter
     * @param _min minimum threshold of the parameter
     * @param _max maximum threshold of the parameter
     */
    function isWithinLimits(
        uint256 _value,
        uint256 _min,
        uint256 _max
    ) internal pure returns (bool) {
        if (_min != 0 && _max != 0) {
            return (_value >= _min && _value <= _max);
        } else if (_min != 0) {
            return (_value >= _min);
        } else if (_max != 0) {
            return (_value <= _max);
        } else {
            return true;
        }
    }

    function destroyPool() public onlyPool {
        delete openBorrowPoolRegistry[msg.sender];
    }

    function updateSupportedBorrowTokens(address _borrowToken, bool _isSupported) external onlyOwner {
        _updateSupportedBorrowTokens(_borrowToken, _isSupported);
    }

    function _updateSupportedBorrowTokens(address _borrowToken, bool _isSupported) internal {
        isBorrowToken[_borrowToken] = _isSupported;
        emit BorrowTokenUpdated(_borrowToken, _isSupported);
    }

    function updateSupportedCollateralTokens(address _collateralToken, bool _isSupported) external onlyOwner {
        _updateSupportedCollateralTokens(_collateralToken, _isSupported);
    }

    function _updateSupportedCollateralTokens(address _collateralToken, bool _isSupported) internal {
        isCollateralToken[_collateralToken] = _isSupported;
        emit CollateralTokenUpdated(_collateralToken, _isSupported);
    }

    function updatepoolInitFuncSelector(bytes4 _functionId) public onlyOwner {
        _updatepoolInitFuncSelector(_functionId);
    }

    function _updatepoolInitFuncSelector(bytes4 _functionId) internal {
        poolInitFuncSelector = _functionId;
        emit PoolInitSelectorUpdated(_functionId);
    }

    function updatePoolTokenInitFuncSelector(bytes4 _functionId) public onlyOwner {
        _updatePoolTokenInitFuncSelector(_functionId);
    }

    function _updatePoolTokenInitFuncSelector(bytes4 _functionId) internal {
        poolTokenInitFuncSelector = _functionId;
        emit PoolTokenInitFuncSelector(_functionId);
    }

    function updatePoolLogic(address _poolLogic) public onlyOwner {
        _updatePoolLogic(_poolLogic);
    }

    function _updatePoolLogic(address _poolLogic) internal {
        poolImpl = _poolLogic;
        emit PoolLogicUpdated(_poolLogic);
    }

    function updateUserRegistry(address _userRegistry) public onlyOwner {
        _updateUserRegistry(_userRegistry);
    }

    function _updateUserRegistry(address _userRegistry) internal {
        userRegistry = _userRegistry;
        emit UserRegistryUpdated(_userRegistry);
    }

    function updateStrategyRegistry(address _strategyRegistry) public onlyOwner {
        _updateStrategyRegistry(_strategyRegistry);
    }

    function _updateStrategyRegistry(address _strategyRegistry) internal {
        strategyRegistry = _strategyRegistry;
        emit StrategyRegistryUpdated(_strategyRegistry);
    }

    function updateRepaymentImpl(address _repaymentImpl) public onlyOwner {
        _updateRepaymentImpl(_repaymentImpl);
    }

    function _updateRepaymentImpl(address _repaymentImpl) internal {
        repaymentImpl = _repaymentImpl;
        emit RepaymentImplUpdated(_repaymentImpl);
    }

    function updatePoolTokenImpl(address _poolTokenImpl) public onlyOwner {
        _updatePoolTokenImpl(_poolTokenImpl);
    }

    function _updatePoolTokenImpl(address _poolTokenImpl) internal {
        poolTokenImpl = _poolTokenImpl;
        emit PoolTokenImplUpdated(_poolTokenImpl);
    }

    function updatePriceoracle(address _priceOracle) public onlyOwner {
        _updatePriceoracle(_priceOracle);
    }

    function _updatePriceoracle(address _priceOracle) internal {
        priceOracle = _priceOracle;
        emit PriceOracleUpdated(_priceOracle);
    }

    function updatedExtension(address _extension) public onlyOwner {
        _updatedExtension(_extension);
    }

    function _updatedExtension(address _extension) internal {
        extension = _extension;
        emit ExtensionImplUpdated(_extension);
    }

    function updateSavingsAccount(address _savingsAccount) public onlyOwner {
        _updateSavingsAccount(_savingsAccount);
    }

    function _updateSavingsAccount(address _savingsAccount) internal {
        savingsAccount = _savingsAccount;
        emit SavingsAccountUpdated(_savingsAccount);
    }

    function updateCollectionPeriod(uint256 _collectionPeriod) public onlyOwner {
        _updateCollectionPeriod(_collectionPeriod);
    }

    function _updateCollectionPeriod(uint256 _collectionPeriod) internal {
        collectionPeriod = _collectionPeriod;
        emit CollectionPeriodUpdated(_collectionPeriod);
    }

    function updateMatchCollateralRatioInterval(uint256 _matchCollateralRatioInterval) public onlyOwner {
        _updateMatchCollateralRatioInterval(_matchCollateralRatioInterval);
    }

    function _updateMatchCollateralRatioInterval(uint256 _matchCollateralRatioInterval) internal {
        matchCollateralRatioInterval = _matchCollateralRatioInterval;
        emit MatchCollateralRatioIntervalUpdated(_matchCollateralRatioInterval);
    }

    function updateMarginCallDuration(uint256 _marginCallDuration) public onlyOwner {
        _updateMarginCallDuration(_marginCallDuration);
    }

    function _updateMarginCallDuration(uint256 _marginCallDuration) internal {
        marginCallDuration = _marginCallDuration;
        emit MarginCallDurationUpdated(_marginCallDuration);
    }

    function updateCollateralVolatilityThreshold(uint256 _collateralVolatilityThreshold) public onlyOwner {
        _updateCollateralVolatilityThreshold(_collateralVolatilityThreshold);
    }

    function _updateCollateralVolatilityThreshold(uint256 _collateralVolatilityThreshold) internal {
        collateralVolatilityThreshold = _collateralVolatilityThreshold;
        emit CollateralVolatilityThresholdUpdated(_collateralVolatilityThreshold);
    }

    function updateGracePeriodPenaltyFraction(uint256 _gracePeriodPenaltyFraction) public onlyOwner {
        _updateGracePeriodPenaltyFraction(_gracePeriodPenaltyFraction);
    }

    function _updateGracePeriodPenaltyFraction(uint256 _gracePeriodPenaltyFraction) internal {
        gracePeriodPenaltyFraction = _gracePeriodPenaltyFraction;
        emit GracePeriodPenaltyFractionUpdated(_gracePeriodPenaltyFraction);
    }

    function updateLiquidatorRewardFraction(uint256 _liquidatorRewardFraction) public onlyOwner {
        _updateLiquidatorRewardFraction(_liquidatorRewardFraction);
    }

    function _updateLiquidatorRewardFraction(uint256 _liquidatorRewardFraction) internal {
        liquidatorRewardFraction = _liquidatorRewardFraction;
        emit LiquidatorRewardFractionUpdated(_liquidatorRewardFraction);
    }

    function updatePoolCancelPenalityFraction(uint256 _poolCancelPenalityFraction) public onlyOwner {
        _updatePoolCancelPenalityFraction(_poolCancelPenalityFraction);
    }

    function _updatePoolCancelPenalityFraction(uint256 _poolCancelPenalityFraction) internal {
        poolCancelPenalityFraction = _poolCancelPenalityFraction;
        emit PoolCancelPenalityFractionUpdated(_poolCancelPenalityFraction);
    }

    function updatePoolSizeLimit(uint256 _min, uint256 _max) external onlyOwner {
        poolSizeLimit = Limits(_min, _max);
        emit LimitsUpdated('PoolSize', _min, _max);
    }

    function updateCollateralRatioLimit(uint256 _min, uint256 _max) external onlyOwner {
        collateralRatioLimit = Limits(_min, _max);
        emit LimitsUpdated('CollateralRatio', _min, _max);
    }

    function updateBorrowRateLimit(uint256 _min, uint256 _max) external onlyOwner {
        borrowRateLimit = Limits(_min, _max);
        emit LimitsUpdated('BorrowRate', _min, _max);
    }

    function updateRepaymentIntervalLimit(uint256 _min, uint256 _max) external onlyOwner {
        repaymentIntervalLimit = Limits(_min, _max);
        emit LimitsUpdated('RepaymentInterval', _min, _max);
    }

    function updateNoOfRepaymentIntervalsLimit(uint256 _min, uint256 _max) external onlyOwner {
        noOfRepaymentIntervalsLimit = Limits(_min, _max);
        emit LimitsUpdated('NoOfRepaymentIntervals', _min, _max);
    }
}
