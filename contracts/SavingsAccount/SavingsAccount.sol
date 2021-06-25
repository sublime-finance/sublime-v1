// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/ISavingsAccount.sol";
import "../interfaces/IStrategyRegistry.sol";
import "../interfaces/IYield.sol";

import "hardhat/console.sol";

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
    mapping(address => mapping(address => mapping(address => uint256)))
        public
        override userLockedBalance;

    //user => asset => to => amount
    mapping(address => mapping(address => mapping(address => uint256)))
        public allowance;

    modifier onlyCreditLine(address _caller) {
        require(_caller == CreditLine, "Invalid caller");
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
        require(
            _strategyRegistry != address(0),
            "SavingsAccount::initialize zero address"
        );
        __Ownable_init();
        super.transferOwnership(_owner);

        strategyRegistry = _strategyRegistry;
        CreditLine = _creditLine;
    }

    // TODO - Number of strategies user can invest in is limited. Make this set specific to user rather than global.

    function updateStrategyRegistry(address _strategyRegistry)
        external
        onlyOwner
    {
        require(
            _strategyRegistry != address(0),
            "SavingsAccount::updateStrategyRegistry zero address"
        );

        strategyRegistry = _strategyRegistry;
    }

    function depositTo(
        uint256 amount,
        address asset,
        address strategy,
        address to
    ) external payable override returns (uint256 sharesReceived) {
        require(
            to != address(0),
            "SavingsAccount::depositTo receiver address should not be zero address"
        );

        sharesReceived = _deposit(amount, asset, strategy);

        userLockedBalance[to][asset][strategy] = userLockedBalance[to][asset][
            strategy
        ]
            .add(sharesReceived);

        emit Deposited(to, amount, asset, strategy);
    }

    function _deposit(
        uint256 amount,
        address asset,
        address strategy
    ) internal returns (uint256 sharesReceived) {
        require(
            amount != 0,
            "SavingsAccount::_deposit Amount must be greater than zero"
        );

        if (strategy != address(0)) {
            sharesReceived = _depositToYield(amount, asset, strategy);
        } else {
            sharesReceived = amount;
            if (asset != address(0)) {
                IERC20(asset).safeTransferFrom(
                    msg.sender,
                    address(this),
                    amount
                );
            } else {
                require(
                    msg.value == amount,
                    "SavingsAccount::deposit ETH sent must be equal to amount"
                );
            }
        }
    }

    function _depositToYield(
        uint256 amount,
        address asset,
        address strategy
    ) internal returns (uint256 sharesReceived) {
        require(
            IStrategyRegistry(strategyRegistry).registry(strategy),
            "SavingsAccount::deposit strategy do not exist"
        );

        if (asset == address(0)) {
            sharesReceived = IYield(strategy).lockTokens{value: amount}(
                msg.sender,
                asset,
                amount
            );
        } else {
            sharesReceived = IYield(strategy).lockTokens(
                msg.sender,
                asset,
                amount
            );
        }
    }

    /**
     * @dev Used to switch saving strategy of an asset
     * @param currentStrategy initial strategy of asset
     * @param newStrategy new strategy to invest
     * @param asset address of the asset
     * @param amount amount of **liquidity shares** to be reinvested
     */
    function switchStrategy(
        address currentStrategy,
        address newStrategy,
        address asset,
        uint256 amount
    ) external override {
        require(
            currentStrategy != newStrategy,
            "SavingsAccount::switchStrategy Same strategy"
        );
        require(
            amount != 0,
            "SavingsAccount::switchStrategy Amount must be greater than zero"
        );

        if (currentStrategy != address(0)) {
            amount = IYield(currentStrategy).getSharesForTokens(amount, asset);
        }

        userLockedBalance[msg.sender][asset][
            currentStrategy
        ] = userLockedBalance[msg.sender][asset][currentStrategy].sub(
            amount,
            "SavingsAccount::switchStrategy Insufficient balance"
        );

        uint256 tokensReceived = amount;
        if (currentStrategy != address(0)) {
            tokensReceived = IYield(currentStrategy).unlockTokens(
                asset,
                amount
            );
        }

        uint256 sharesReceived = tokensReceived;
        if (newStrategy != address(0)) {
            if (asset != address(0)) {
                IERC20(asset).approve(newStrategy, tokensReceived);
            }

            sharesReceived = _depositToYield(
                tokensReceived,
                asset,
                newStrategy
            );
        }

        userLockedBalance[msg.sender][asset][newStrategy] = userLockedBalance[
            msg.sender
        ][asset][newStrategy]
            .add(sharesReceived);

        emit StrategySwitched(msg.sender, asset, currentStrategy, newStrategy);
    }

    /**
     * @dev Used to withdraw asset from Saving Account
     * @param withdrawTo address to which asset should be sent
     * @param amount amount of liquidity shares to withdraw
     * @param asset address of the asset to be withdrawn
     * @param strategy strategy from where asset has to withdrawn(ex:- compound,Aave etc)
     * @param withdrawShares boolean indicating to withdraw in liquidity share or underlying token
     */
    function withdraw(
        address payable withdrawTo,
        uint256 amount, // this is token amonut (not liquidity share amount)
        address asset,
        address strategy,
        bool withdrawShares
    ) external override returns (uint256 amountReceived) {
        require(
            amount != 0,
            "SavingsAccount::withdraw Amount must be greater than zero"
        );

        if (strategy != address(0)) {
            amount = IYield(strategy).getSharesForTokens(amount, asset);
        }

        // TODO not considering yield generated, needs to be updated later
        userLockedBalance[msg.sender][asset][strategy] = userLockedBalance[
            msg.sender
        ][asset][strategy]
            .sub(amount, "SavingsAccount::withdraw Insufficient amount");

        address token;
        (token, amountReceived) = _withdraw(
            withdrawTo,
            amount,
            asset,
            strategy,
            withdrawShares
        );

        emit Withdrawn(msg.sender, withdrawTo, amountReceived, token, strategy);
    }

    function withdrawFrom(
        address from,
        address payable to,
        uint256 amount,
        address asset,
        address strategy,
        bool withdrawShares
    ) external override returns (uint256 amountReceived) {
        require(
            amount != 0,
            "SavingsAccount::withdrawFrom Amount must be greater than zero"
        );

        allowance[from][asset][msg.sender] = allowance[from][asset][msg.sender]
            .sub(
            amount,
            "SavingsAccount::withdrawFrom allowance limit exceeding"
        );

        if (strategy != address(0)) {
            amount = IYield(strategy).getSharesForTokens(amount, asset);
        }

        //reduce sender's balance
        userLockedBalance[from][asset][strategy] = userLockedBalance[from][
            asset
        ][strategy]
            .sub(amount, "SavingsAccount::withdrawFrom insufficient balance");

        address token;
        (token, amountReceived) = _withdraw(
            to,
            amount,
            asset,
            strategy,
            withdrawShares
        );

        emit Withdrawn(from, msg.sender, amountReceived, token, strategy);
    }

    function _withdraw(
        address payable withdrawTo,
        uint256 amount,
        address asset,
        address strategy,
        bool withdrawShares
    ) internal returns (address token, uint256 amountReceived) {
        if (strategy == address(0)) {
            amountReceived = amount;
            _transfer(asset, withdrawTo, amountReceived);
            token = asset;
            amountReceived = amount;
        } else {
            if (withdrawShares) {
                token = IYield(strategy).liquidityToken(asset);
                require(
                    token != address(0),
                    "Liquidity Tokens address cannot be address(0)"
                );
                // uint256 sharesToWithdraw = IYield(strategy).getSharesForTokens(amount, asset);
                amountReceived = IYield(strategy).unlockShares(token, amount);
                _transfer(token, withdrawTo, amountReceived);
            } else {
                token = asset;
                amountReceived = IYield(strategy).unlockTokens(asset, amount);
                _transfer(token, withdrawTo, amountReceived);
            }
        }
    }

    function _transfer(
        address token,
        address payable withdrawTo,
        uint256 amount
    ) internal {
        if (token == address(0)) {
            withdrawTo.transfer(amount);
        } else {
            IERC20(token).safeTransfer(withdrawTo, amount);
        }
    }

    function withdrawAll(address _asset)
        external
        override
        returns (uint256 tokenReceived)
    {
        tokenReceived = userLockedBalance[msg.sender][_asset][address(0)];

        // Withdraw tokens
        address[] memory _strategyList =
            IStrategyRegistry(strategyRegistry).getStrategies();

        for (uint256 index = 0; index < _strategyList.length; index++) {
            if (
                userLockedBalance[msg.sender][_asset][_strategyList[index]] != 0
            ) {
                tokenReceived = tokenReceived.add(
                    IYield(_strategyList[index]).unlockTokens(
                        _asset,
                        userLockedBalance[msg.sender][_asset][
                            _strategyList[index]
                        ]
                    )
                );
            }
        }

        if (tokenReceived == 0) return 0;

        if (_asset == address(0)) {
            msg.sender.transfer(tokenReceived);
        } else {
            IERC20(_asset).safeTransfer(msg.sender, tokenReceived);
        }

        emit WithdrawnAll(msg.sender, tokenReceived, _asset);
    }

    function approve(
        address token,
        address to,
        uint256 amount
    ) external override {
        allowance[msg.sender][token][to] = amount;

        emit Approved(token, msg.sender, to, amount);
    }

    function approveFromToCreditLine(
        address token,
        address from,
        uint256 amount
    ) external override onlyCreditLine(msg.sender) {
        allowance[from][token][msg.sender] = allowance[from][token][msg.sender]
            .add(amount);

        emit CreditLineAllowanceRefreshed(token, from, amount);
    }

    function transfer(
        address token,
        address to,
        address strategy,
        uint256 amount
    ) external override returns (uint256) {
        require(amount != 0, "SavingsAccount::transfer zero amount");

        if (strategy != address(0)) {
            amount = IYield(strategy).getSharesForTokens(amount, token);
        }

        //reduce msg.sender balance
        userLockedBalance[msg.sender][token][strategy] = userLockedBalance[
            msg.sender
        ][token][strategy]
            .sub(amount, "SavingsAccount::transfer insufficient funds");

        //update receiver's balance
        userLockedBalance[to][token][strategy] = userLockedBalance[to][token][
            strategy
        ]
            .add(amount);

        emit Transfer(token, strategy, msg.sender, to, amount);
        //not sure
        return amount;
    }

    function transferFrom(
        address token,
        address from,
        address to,
        address strategy,
        uint256 amount
    ) external override returns (uint256) {
        require(amount != 0, "SavingsAccount::transferFrom zero amount");
        //update allowance
        allowance[from][token][msg.sender] = allowance[from][token][msg.sender]
            .sub(
            amount,
            "SavingsAccount::transferFrom allowance limit exceeding"
        );

        if (strategy != address(0)) {
            amount = IYield(strategy).getSharesForTokens(amount, token);
        }

        //reduce sender's balance
        userLockedBalance[from][token][strategy] = userLockedBalance[from][
            token
        ][strategy]
            .sub(amount, "SavingsAccount::transferFrom insufficient allowance");

        //update receiver's balance
        userLockedBalance[to][token][strategy] = (
            userLockedBalance[to][token][strategy]
        )
            .add(amount);

        emit Transfer(token, strategy, from, to, amount);

        //not sure
        return amount;
    }

    function getTotalAsset(address _user, address _asset)
        public
        override
        returns (uint256 _totalTokens)
    {
        address[] memory _strategyList =
            IStrategyRegistry(strategyRegistry).getStrategies();

        for (uint256 _index = 0; _index < _strategyList.length; _index++) {
            uint256 _liquidityShares =
                userLockedBalance[_user][_strategyList[_index]][_asset];

            if (_liquidityShares != 0) {
                uint256 _tokenInStrategy = _liquidityShares;
                if (_strategyList[_index] != address(0)) {
                    _tokenInStrategy = IYield(_strategyList[_index])
                        .getTokensForShares(_liquidityShares, _asset);
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
