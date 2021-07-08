// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';

import '../interfaces/ISavingsAccount.sol';
import '../interfaces/IStrategyRegistry.sol';
import '../interfaces/IYield.sol';

import 'hardhat/console.sol';

/**
 * @title Savings account contract with Methods related to savings account
 * @notice Implements the functions related to savings account
 * @author Sublime
 **/
contract SavingsAccount is ISavingsAccount, Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address public strategyRegistry;
    address public CreditLine;

    //user -> asset -> strategy (underlying address) -> amount (shares)
    mapping(address => mapping(address => mapping(address => uint256))) public override userLockedBalance;

    //user => asset => to => amount
    mapping(address => mapping(address => mapping(address => uint256))) public allowance;

    modifier onlyCreditLine(address _caller) {
        require(_caller == CreditLine, 'Invalid caller');
        _;
    }

    // TODO : Track strategies per user and limit no of strategies to 5

    /**
     * @dev initialize the contract
     * @param _owner address of the owner of the savings account contract
     * @param _strategyRegistry address of the strategy registry
     **/
    function initialize(
        address _owner,
        address _strategyRegistry,
        address _creditLine
    ) public initializer {
        require(_strategyRegistry != address(0), 'SavingsAccount::initialize zero address');
        __Ownable_init();
        super.transferOwnership(_owner);

        strategyRegistry = _strategyRegistry;
        CreditLine = _creditLine;
    }

    /*
    * @notice invoked to update the credit line implementation
    * @param _creditLine address of credit line implementation
    */
    function updateCreditLine(address _creditLine) external onlyOwner {
        CreditLine = _creditLine;
    }

    /*
    * @notice invoked to update the savings account strategy registry
    * @param _strategyRegistry address of the strategy registry
    */
    function updateStrategyRegistry(address _strategyRegistry) external onlyOwner {
        require(_strategyRegistry != address(0), 'SavingsAccount::updateStrategyRegistry zero address');

        strategyRegistry = _strategyRegistry;
    }

    /*
    * @notice called to deposit assets into a savings account strategy
    * @param amount amount to be transferred
    * @param asset asset to be transferred
    * @param strategy strategy into which assets should be deposited
    * @param to address of the savings account owner
    */
    function depositTo(
        uint256 _amount,
        address _asset,
        address _strategy,
        address _to
    ) external payable override returns (uint256 _sharesReceived) {
        require(_to != address(0), "SavingsAccount::depositTo receiver address should not be zero address");

        _sharesReceived = _deposit(_amount, _asset, _strategy);

        userLockedBalance[_to][_asset][_strategy] = userLockedBalance[_to][_asset][_strategy]
                                                    .add(_sharesReceived);

        emit Deposited(_to, _amount, _asset, _strategy);
    }

    /*
    * @notice internal function used to make the actuall calls to yield strategies depending on the strategy argument
    * @param _amount amount to be transferred
    * @param _asset assets to be transferred
    * @param _strategy strategy into which assets will be transferred
    */
    function _deposit(
        uint256 _amount,
        address _asset,
        address _strategy
    ) internal returns (uint256 _sharesReceived) {
        require(_amount != 0, "SavingsAccount::_deposit Amount must be greater than zero");

        if (_strategy != address(0)) {
            _sharesReceived = _depositToYield(_amount, _asset, _strategy);
        } else {
            _sharesReceived = _amount;
            if (_asset != address(0)) {
                IERC20(_asset).safeTransferFrom(msg.sender, address(this), _amount);
            } else {
                require(msg.value == _amount, "SavingsAccount::deposit ETH sent must be equal to _amount");
            }
        }
    }

    /*
    * @notice invoked to deposit assets in a specific strategy
    * @param _amount amount to be deposited
    * @param _asset asset to be deposited
    * @param _strategy strategy into which assets should be deposited
    */
    function _depositToYield(
        uint256 _amount,
        address _asset,
        address _strategy
    ) internal returns (uint256 _sharesReceived) {
        require(
            IStrategyRegistry(strategyRegistry).registry(_strategy),
            "SavingsAccount::deposit _strategy do not exist"
        );

        if (_asset == address(0)) {
            _sharesReceived = IYield(_strategy).lockTokens{value: _amount}(msg.sender, _asset, _amount);
        } else {
            _sharesReceived = IYield(_strategy).lockTokens(msg.sender, _asset, _amount);
        }
    }

    /**
     * @dev Used to switch saving strategy of an asset
     * @param _currentStrategy initial strategy of asset
     * @param _newStrategy new strategy to invest
     * @param _asset address of the asset
     * @param _amount amount of **liquidity shares** to be reinvested
     */
    function switchStrategy(
        address _currentStrategy,
        address _newStrategy,
        address _asset,
        uint256 _amount
    ) external override {
        require(_currentStrategy != _newStrategy, "SavingsAccount::switchStrategy Same strategy");
        require(_amount != 0, "SavingsAccount::switchStrategy Amount must be greater than zero");

        if (_currentStrategy != address(0)) {
            _amount = IYield(_currentStrategy).getSharesForTokens(_amount, _asset);
        }

        userLockedBalance[msg.sender][_asset][_currentStrategy] = userLockedBalance[msg.sender][_asset][_currentStrategy]
                                                                    .sub(_amount, "SavingsAccount::switchStrategy Insufficient balance");

        uint256 _tokensReceived = _amount;
        if (_currentStrategy != address(0)) {
            _tokensReceived = IYield(_currentStrategy).unlockTokens(_asset, _amount);
        }

        uint256 _sharesReceived = _tokensReceived;
        if (_newStrategy != address(0)) {
            if (_asset != address(0)) {
                IERC20(_asset).approve(_newStrategy, _tokensReceived);
            }

            _sharesReceived = _depositToYield(_tokensReceived, _asset, _newStrategy);
        }

        userLockedBalance[msg.sender][_asset][_newStrategy] = userLockedBalance[msg.sender][_asset][_newStrategy]
                                                                .add(_sharesReceived);

        emit StrategySwitched(msg.sender, _asset, _currentStrategy, _newStrategy);
    }

    /**
     * @dev Used to withdraw asset from Saving Account
     * @param _withdrawTo address to which asset should be sent
     * @param _amount amount of liquidity shares to withdraw
     * @param _asset address of the asset to be withdrawn
     * @param _strategy strategy from where asset has to withdrawn(ex:- compound,Aave etc)
     * @param _withdrawShares boolean indicating to withdraw in liquidity share or underlying token
     */
    function withdraw(
        address payable _withdrawTo,
        uint256 _amount,
        address _asset,
        address _strategy,
        bool _withdrawShares
    ) external override returns (uint256 _amountReceived) {
        require(_amount != 0, "SavingsAccount::withdraw Amount must be greater than zero");

        if (_strategy != address(0)) {
            _amount = IYield(_strategy).getSharesForTokens(_amount, _asset);
        }
        
        userLockedBalance[msg.sender][_asset][_strategy] = userLockedBalance[msg.sender][_asset][_strategy]
                                                            .sub(_amount, "SavingsAccount::withdraw Insufficient amount");

        address _token;
        (_token, _amountReceived) = _withdraw(_withdrawTo, _amount, _asset, _strategy, _withdrawShares);

        emit Withdrawn(msg.sender, _withdrawTo, _amountReceived, _token, _strategy);
    }

    /*
    * @notice used to withdraw assets from a savings account strategy
    * @param _from sender address
    * @param _to receiver address
    * @param _amount amount to be withdrawn
    * @param _asset asset to be withdrawn
    * @param _strategy strategy from which asset should be withdrawn
    * @param _withdrawShares if true, LP tokens are withdrawn. If false, LP tokens are converted to base
    *                       tokens before transferring
    */
    function withdrawFrom(
        address _from,
        address payable _to,
        uint256 _amount,
        address _asset,
        address _strategy,
        bool _withdrawShares
    ) external override returns (uint256 _amountReceived) {
        require(_amount != 0, "SavingsAccount::withdrawFrom Amount must be greater than zero");

        allowance[_from][_asset][msg.sender] = allowance[_from][_asset][msg.sender]
                                                .sub(_amount, "SavingsAccount::withdrawFrom allowance limit exceeding");

        if (_strategy != address(0)) {
            _amount = IYield(_strategy).getSharesForTokens(_amount, _asset);
        }

        //reduce sender's balance
        userLockedBalance[_from][_asset][_strategy] = userLockedBalance[_from][_asset][_strategy]
                                                        .sub(_amount, "SavingsAccount::withdrawFrom insufficient balance");

        address _token;
        (_token, _amountReceived) = _withdraw(_to, _amount, _asset, _strategy, _withdrawShares);

        emit Withdrawn(_from, msg.sender, _amountReceived, _token, _strategy);
    }

    /*
    * @notice invoked to perform the actual withdrawals
    * @param _withdrawTo receiver address
    * @param _amount amount to be withdrawn
    * @param _asset asset to be withdrawn
    * @param _strategy strategy from which asset should be withdrawn
    * @param _withdrawShares if true, LP tokens are withdrawn. If false, LP tokens are converted to base
    *                       tokens before transferring
    */
    function _withdraw(
        address payable _withdrawTo,
        uint256 _amount,
        address _asset,
        address _strategy,
        bool _withdrawShares
    ) internal returns (address _token, uint256 _amountReceived) {
        if (_strategy == address(0)) {
            _amountReceived = _amount;
            _transfer(_asset, _withdrawTo, _amountReceived);
            _token = _asset;
            _amountReceived = _amount;
        } else {
            if (_withdrawShares) {
                _token = IYield(_strategy).liquidityToken(_asset);
                require(_token != address(0), "Liquidity Tokens address cannot be address(0)");
                _amountReceived = IYield(_strategy).unlockShares(_token, _amount);
                _transfer(_token, _withdrawTo, _amountReceived);
            } else {
                _token = _asset;
                _amountReceived = IYield(_strategy).unlockTokens(_asset, _amount);
                _transfer(_token, _withdrawTo, _amountReceived);
            }
        }
    }

    /*
    * @notice invoked to perform token transfers, sender is the contract
    * @param _token asset to transfer
    * @param _withdrawTo receiver address
    * @param _amount amount to be transferred
    */
    function _transfer(
        address _token,
        address payable _withdrawTo,
        uint256 _amount
    ) internal {
        if (_token == address(0)) {
            _withdrawTo.transfer(_amount);
        } else {
            IERC20(_token).safeTransfer(_withdrawTo, _amount);
        }
    }

    /*
    * @notice invoked to transfer tokens in all strategies for an asset to msg.sender
    * @param _asset asset to be withdrawn
    */
    function withdrawAll(address _asset) external override returns (uint256 _tokenReceived) {
        _tokenReceived = userLockedBalance[msg.sender][_asset][address(0)];

        // Withdraw tokens
        address[] memory _strategyList = IStrategyRegistry(strategyRegistry).getStrategies();

        for (uint256 _index = 0; _index < _strategyList.length; _index++) {
            if (userLockedBalance[msg.sender][_asset][_strategyList[_index]] != 0) {
                _tokenReceived = _tokenReceived.add(
                    IYield(_strategyList[_index]).unlockTokens(
                        _asset,
                        userLockedBalance[msg.sender][_asset][_strategyList[_index]]
                    )
                );
            }
        }

        if (_tokenReceived == 0) return 0;

        if (_asset == address(0)) {
            msg.sender.transfer(_tokenReceived);
        } else {
            IERC20(_asset).safeTransfer(msg.sender, _tokenReceived);
        }

        emit WithdrawnAll(msg.sender, _tokenReceived, _asset);
    }

    function approve(
        address _token,
        address _to,
        uint256 _amount
    ) external override {
        allowance[msg.sender][_token][_to] = _amount;

        emit Approved(_token, msg.sender, _to, _amount);
    }

    function approveFromToCreditLine(
        address _token,
        address from,
        uint256 amount
    ) external override onlyCreditLine(msg.sender) {
        allowance[from][_token][msg.sender] = allowance[from][_token][msg.sender].add(amount);

        emit CreditLineAllowanceRefreshed(_token, from, amount);
    }

    function transfer(
        address _token,
        address _to,
        address _strategy,
        uint256 _amount
    ) external override returns (uint256) {
        require(_amount != 0, "SavingsAccount::transfer zero amount");

        if (_strategy != address(0)) {
            _amount = IYield(_strategy).getSharesForTokens(_amount, _token);
        }

        //reduce msg.sender balance
        userLockedBalance[msg.sender][_token][_strategy] = userLockedBalance[msg.sender][_token][_strategy]
                                                            .sub(_amount, "SavingsAccount::transfer insufficient funds");

        //update receiver's balance
        userLockedBalance[_to][_token][_strategy] = userLockedBalance[_to][_token][_strategy].add(_amount);

        emit Transfer(_token, _strategy, msg.sender, _to, _amount);
        //not sure
        return _amount;
    }

    function transferFrom(
        address _token,
        address _from,
        address _to,
        address _strategy,
        uint256 _amount
    ) external override returns (uint256) {
        require(_amount != 0, "SavingsAccount::transferFrom zero amount");
        //update allowance
        allowance[_from][_token][msg.sender] = allowance[_from][_token][msg.sender]
            .sub(_amount, "SavingsAccount::transferFrom allowance limit exceeding");

        if (_strategy != address(0)) {
            _amount = IYield(_strategy).getSharesForTokens(_amount, _token);
        }

        //reduce sender's balance
        userLockedBalance[_from][_token][_strategy] = userLockedBalance[_from][_token][_strategy]
                                                        .sub(_amount, "SavingsAccount::transferFrom insufficient allowance");

        //update receiver's balance
        userLockedBalance[_to][_token][_strategy] = (userLockedBalance[_to][_token][_strategy]).add(_amount);

        emit Transfer(_token, _strategy, _from, _to, _amount);

        //not sure
        return _amount;
    }

    /*
    * @notice invoked to get user's total deposit amount (including yield) for an asset across all strategies
    * @param _user user whose assets are to be calculated
    * @param _asset target asset
    */
    function getTotalAsset(address _user, address _asset) public override returns (uint256 _totalTokens) {
        address[] memory _strategyList = IStrategyRegistry(strategyRegistry).getStrategies();

        for (uint256 _index = 0; _index < _strategyList.length; _index++) {
            uint256 _liquidityShares = userLockedBalance[_user][_strategyList[_index]][_asset];

            if (_liquidityShares != 0) {
                uint256 _tokenInStrategy = _liquidityShares;
                if (_strategyList[_index] != address(0)) {
                    _tokenInStrategy = IYield(_strategyList[_index]).getTokensForShares(_liquidityShares, _asset);
                }

                _totalTokens = _totalTokens.add(_tokenInStrategy);
            }
        }
    }

    receive() external payable {
        // require(
        //     IStrategyRegistry(strategyRegistry).registry(msg.sender),
        //     "SavingsAccount::receive invalid transaction"
        // );
        // the above snippet of code causes gas issues. Commented till solution is found
    }
}
