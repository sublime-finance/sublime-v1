pragma solidity 0.7.0;

import '../interfaces/ISavingsAccount.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

library SavingsAccountUtil {
    using SafeERC20 for IERC20;

    /*
    * @notice Used in Pool to handle deposits into savings account, depending on whether deposits are being made to a savings account or external wallets
    * @param _savingsAccount savings account instance
    * @param _from sender address
    * @param _to receiver address
    * @param _amount amount to be transferred
    * @param _asset asset to be transferred
    * @param _strategy if _toSavingsAccount is true, _strategy is the savings strategy address from which 
    *                  _amount is pulled and deposited into. If false, _strategy is the savings strategy 
    *                  from which _amount is pulled
    * @param _withdrawShares if true, LP tokens are deposited directly without unlocking into base assets. 
    *                        If false, LP tokens are converted into base tokens and then withdrawn
    * @param _toSavingsAccount if true, deposit is being made to another savings account. if false, _to 
    *                          is an external address
    */
    function depositFromSavingsAccount(
        ISavingsAccount _savingsAccount,
        address _from,
        address _to,
        uint256 _amount,
        address _asset,
        address _strategy,
        bool _withdrawShares,
        bool _toSavingsAccount
    ) internal returns (uint256) {
        if (_toSavingsAccount) {
            return savingsAccountTransfer(_savingsAccount, _from, _to, _amount, _asset, _strategy);
        } else {
            return withdrawFromSavingsAccount(_savingsAccount, _from, _to, _amount, _asset, _strategy, _withdrawShares);
        }
    }

    /*
    * @notice invoked by _deposit() in Pool.sol when deposit is made from an external wallet
    * @param _savingsAccount savings account instance
    * @param _from sender address
    * @param _to receiver address
    * @param _amount amount to be deposited
    * @param _asset asset to be deposited
    * @param _toSavingsAccount if true, deposit is being made to a savings account. if false, deposit is being 
    *                           made to an external account
    * @param _strategy if _toSavingsAccount is true, _strategy is the strategy into which _amount is getting deposited
    */
    function directDeposit(
        ISavingsAccount _savingsAccount,
        address _from,
        address _to,
        uint256 _amount,
        address _asset,
        bool _toSavingsAccount,
        address _strategy
    ) internal returns (uint256) {
        if (_toSavingsAccount) {
            return directSavingsAccountDeposit(_savingsAccount, _from, _to, _amount, _asset, _strategy);
        } else {
            return transferTokens(_asset, _amount, _from, _to);
        }
    }

    /*
    * @notice invoked when amount is deposited to savings account from an external wallet
    * @param _savingsAccount savings account instance
    * @param _from sender address
    * @param _to receiver address
    * @param _amount amount to be transferred
    * @param _asset asset to be transferred
    * @param _strategy savings account strategy into wihch amount should be transferred
    */
    function directSavingsAccountDeposit(
        ISavingsAccount _savingsAccount,
        address _from,
        address _to,
        uint256 _amount,
        address _asset,
        address _strategy
    ) internal returns (uint256 _sharesReceived) {
        transferTokens(_asset, _amount, _from, address(this));
        uint256 _ethValue;
        if (_asset == address(0)) {
            _ethValue = _amount;
        } else {
            address _approveTo = _strategy;
            if (_strategy == address(0)) {
                _approveTo = address(_savingsAccount);
            }
            IERC20(_asset).safeApprove(_approveTo, _amount);
        }
        _sharesReceived = _savingsAccount.depositTo{value: _ethValue}(_amount, _asset, _strategy, _to);
    }

    /*
    * @notice invoked when transfer is being made from one savings account to another savings account
    * @param _savingsAccount savings account instance
    * @param _from sender address
    * @param _to receiver address
    * @param _amount amount to be transferred
    * @param _asset asset to be transferred
    * @param _strategy strategy from which amount is withdrawn from _from and also the strategy into which
    *                   it is deposited in _to
    */
    function savingsAccountTransfer(
        ISavingsAccount _savingsAccount,
        address _from,
        address _to,
        uint256 _amount,
        address _asset,
        address _strategy
    ) internal returns (uint256) {
        if (_from == address(this)) {
            _savingsAccount.transfer(_asset, _to, _strategy, _amount);
        } else {
            _savingsAccount.transferFrom(_asset, _from, _to, _strategy, _amount);
        }
        return _amount;
    }

    /*
    * @notice used to withdraw assets from a savings account to a given address
    * @param _savingsAccount savings account instance
    * @param _from sender address
    * @param _to receiver address
    * @param _amount amount to be withdrawn
    * @param _asset asset to be transferred
    * @param _strategy strategy from which assets are withdrawn
    * @param _withdrawShares if true, assets as withdrawn as LP tokens. if false, LP tokens are converted
    *                           into underlying base tokens and then withdrawn
    */
    function withdrawFromSavingsAccount(
        ISavingsAccount _savingsAccount,
        address _from,
        address _to,
        uint256 _amount,
        address _asset,
        address _strategy,
        bool _withdrawShares
    ) internal returns (uint256 _amountReceived) {
        if (_from == address(this)) {
            _amountReceived = _savingsAccount.withdraw(payable(_to), _amount, _asset, _strategy, _withdrawShares);
        } else {
            _amountReceived = _savingsAccount.withdrawFrom(
                _from,
                payable(_to),
                _amount,
                _asset,
                _strategy,
                _withdrawShares
            );
        }
    }

    /*
    * @notice used to make the actual transfer of tokens between _from and _to
    * @param _asset asset to be transferred
    * @param _amount amount to be transferred
    * @param _from sender address
    * @param _to receiver address
    */
    function transferTokens(
        address _asset,
        uint256 _amount,
        address _from,
        address _to
    ) internal returns (uint256) {
        if (_asset == address(0)) {
            require(msg.value >= _amount, '');
            if (_to != address(this)) {
                payable(_to).transfer(_amount);
            }
            if (msg.value >= _amount) {
                payable(address(msg.sender)).transfer(msg.value - _amount);
            } else {
                revert('Insufficient Ether');
            }
            return _amount;
        }
        if (_from == address(this)) {
            IERC20(_asset).transfer(_to, _amount);
        } else {
            IERC20(_asset).transferFrom(_from, _to, _amount);
        }
        return _amount;
    }
}
