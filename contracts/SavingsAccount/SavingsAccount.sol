// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/ISavingsAccount.sol";
import "../interfaces/IStrategyRegistry.sol";
import "../interfaces/IYield.sol";

/**
 * @title Savings account contract with Methods related to savings account
 * @notice Implements the functions related to savings account
 * @author Sublime
 **/
contract SavingsAccount is ISavingsAccount, Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address public strategyRegistry;

    //user -> strategy -> token (underlying address) -> amount (shares)
    mapping(address => mapping(address => mapping(address => uint256)))
        public userLockedBalance;

    //user => asset => to => amount
    mapping(address => mapping(address => mapping(address => uint256)))
        public allowance;

    // TODO : Track strategies per user and limit no of strategies to 5

    /**
     * @dev initialize the contract
     * @param _owner address of the owner of the savings account contract
     * @param _strategyRegistry address of the strategy registry
     **/
    function initialize(address _owner, address _strategyRegistry)
        public
        initializer
    {
        require(
            _strategyRegistry != address(0),
            "SavingsAccount::initialize zero address"
        );
        __Ownable_init();
        super.transferOwnership(_owner);

        strategyRegistry = _strategyRegistry;
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

    /**
     * @dev This function is used to deposit asset into savings account.
     * @dev It also helps in investing the asset.
     * @notice The asset should be approved to desired strategy beforehand
     * @param amount amount of asset deposited
     * @param asset address of asset deposited
     * @param strategy address of strategy to invest in
     */
    function deposit(
        uint256 amount,
        address asset,
        address strategy
    ) external payable override returns (uint256 sharesReceived) {
        sharesReceived = _deposit(amount, asset, strategy);

        userLockedBalance[msg.sender][asset][strategy] = userLockedBalance[
            msg.sender
        ][asset][strategy]
            .add(sharesReceived);

        emit Deposited(msg.sender, amount, asset, strategy);
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
                IERC20(asset).transferFrom(msg.sender, address(this), amount);
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
        uint256 amount,
        address asset,
        address strategy,
        bool withdrawShares
    ) external override returns (uint256 amountReceived) {
        require(
            amount != 0,
            "SavingsAccount::withdraw Amount must be greater than zero"
        );

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

        //reduce sender's balance
        userLockedBalance[from][asset][strategy] = userLockedBalance[from][
            asset
        ][strategy]
            .sub(amount, "SavingsAccount::withdrawFrom insufficient balance");

        address token;
        (token, amountReceived) = _withdraw(
            msg.sender,
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
        amountReceived = amount;
        if (!withdrawShares || strategy != address(0)) {
            amountReceived = IYield(strategy).unlockTokens(asset, amount);
        }

        token = asset;
        if (withdrawShares) token = IYield(strategy).liquidityToken(asset);

        if (token == address(0)) {
            withdrawTo.transfer(amountReceived);
        } else {
            IERC20(token).safeTransfer(withdrawTo, amountReceived);
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
        require(amount != 0, "SavingsAccount::approve zero amount");
        allowance[msg.sender][token][to] = allowance[msg.sender][token][to].add(
            amount
        );

        emit Approved(token, msg.sender, to, amount);
    }

    function transfer(
        address token,
        address to,
        address investedTo,
        uint256 amount
    ) external override returns (uint256) {
        require(amount != 0, "SavingsAccount::transfer zero amount");

        //reduce msg.sender balance
        userLockedBalance[msg.sender][token][investedTo] = userLockedBalance[
            msg.sender
        ][token][investedTo]
            .sub(amount, "SavingsAccount::transfer insufficient funds");

        //update receiver's balance
        userLockedBalance[to][token][investedTo] = userLockedBalance[to][token][
            investedTo
        ]
            .add(amount);

        emit Transfer(token, investedTo, msg.sender, to, amount);
        //not sure
        return amount;
    }

    function transferFrom(
        address token,
        address from,
        address to,
        address investedTo,
        uint256 amount
    ) external override returns (uint256) {
        require(amount != 0, "SavingsAccount::transferFrom zero amount");

        //update allowance
        allowance[from][token][msg.sender] = allowance[from][token][msg.sender]
            .sub(
            amount,
            "SavingsAccount::transferFrom allowance limit exceeding"
        );

        //reduce sender's balance
        userLockedBalance[from][token][investedTo] = userLockedBalance[from][
            token
        ][investedTo]
            .sub(amount, "SavingsAccount::transferFrom insufficient allowance");

        //update receiver's balance
        userLockedBalance[to][token][investedTo] = (
            userLockedBalance[to][token][investedTo]
        )
            .add(amount);

        emit Transfer(token, investedTo, from, to, amount);

        //not sure
        return amount;
    }

    receive() external payable {
        require(
            IStrategyRegistry(strategyRegistry).registry(msg.sender),
            "SavingsAccount::receive invalid transaction"
        );
    }
}
