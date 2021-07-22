// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.7.0;

import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts-upgradeable/proxy/Initializable.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import './RepaymentStorage.sol';
import '../interfaces/IPool.sol';
import '../interfaces/IRepayment.sol';
import '../interfaces/ISavingsAccount.sol';

contract Repayments is Initializable, RepaymentStorage, IRepayment, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event InterestRepaid(address poolID, uint256 repayAmount); // Made during current period interest repayment
    event MissedRepaymentRepaid(address poolID); // Previous period's interest is repaid fully
    event PartialExtensionRepaymentMade(address poolID); // Previous period's interest is repaid partially

    event PoolFactoryUpdated(address poolFactory);
    event SavingsAccountUpdated(address savingnsAccount);
    event GracePenalityRateUpdated(uint256 gracePenaltyRate);
    event GracePeriodFractionUpdated(uint256 gracePeriodFraction);

    modifier isPoolInitialized(address _poolID) {
        require(repaymentConstants[_poolID].numberOfTotalRepayments != 0, 'Pool is not Initiliazed');
        _;
    }

    modifier onlyValidPool {
        require(
            poolFactory.openBorrowPoolRegistry(msg.sender),
            'Repayments::onlyValidPool - Invalid Pool'
        );
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == poolFactory.owner(), "Not owner");
        _;
    }

    function initialize(
        address _poolFactory,
        uint256 _gracePenaltyRate,
        uint256 _gracePeriodFraction,
        address _savingsAccount
    ) public initializer {
        _updatePoolFactory(_poolFactory);
        _updateGracePenalityRate(_gracePenaltyRate);
        _updateGracePeriodFraction(_gracePeriodFraction);
        _updateSavingsAccount(_savingsAccount);
    }

    function updatePoolFactory(address _poolFactory) public onlyOwner {
        _updatePoolFactory(_poolFactory);
    }

    function _updatePoolFactory(address _poolFactory) internal {
        require(_poolFactory != address(0), "0 address not allowed");
        poolFactory = IPoolFactory(_poolFactory);
        emit PoolFactoryUpdated(_poolFactory);
    }

    function updateGracePeriodFraction(uint256 _gracePeriodFraction) public onlyOwner {
        _updateGracePeriodFraction(_gracePeriodFraction);
    }

    function _updateGracePeriodFraction(uint256 _gracePeriodFraction) internal {
        gracePeriodFraction = _gracePeriodFraction;
        emit GracePeriodFractionUpdated(_gracePeriodFraction);
    }

    function updateGracePenalityRate(uint256 _gracePenaltyRate) public onlyOwner {
        _updateGracePenalityRate(_gracePenaltyRate);
    }

    function _updateGracePenalityRate(uint256 _gracePenaltyRate) internal {
        gracePenaltyRate = _gracePenaltyRate;
        emit GracePenalityRateUpdated(_gracePenaltyRate);
    }

    function updateSavingsAccount(address _savingsAccount) public onlyOwner {
        _updateSavingsAccount(_savingsAccount);
    }

    function _updateSavingsAccount(address _savingsAccount) internal {
        require(_savingsAccount != address(0), "0 address not allowed");
        savingsAccount = _savingsAccount;
        emit SavingsAccountUpdated(_savingsAccount);
    }

    function initializeRepayment(
        uint256 numberOfTotalRepayments,
        uint256 repaymentInterval,
        uint256 borrowRate,
        uint256 loanStartTime,
        address lentAsset
    ) external override onlyValidPool {
        repaymentConstants[msg.sender].gracePenaltyRate = gracePenaltyRate;
        repaymentConstants[msg.sender].gracePeriodFraction = gracePeriodFraction;
        repaymentConstants[msg.sender].numberOfTotalRepayments = numberOfTotalRepayments;
        repaymentConstants[msg.sender].loanDuration = repaymentInterval.mul(numberOfTotalRepayments).mul(10**30);
        repaymentConstants[msg.sender].repaymentInterval = repaymentInterval.mul(10**30);
        repaymentConstants[msg.sender].borrowRate = borrowRate;
        repaymentConstants[msg.sender].loanStartTime = loanStartTime.mul(10**30);
        repaymentConstants[msg.sender].repayAsset = lentAsset;
        repaymentConstants[msg.sender].savingsAccount = savingsAccount;
        repaymentVars[msg.sender].nInstalmentsFullyPaid = 0;
    }

    /*
     * @notice returns the number of repayment intervals that have been repaid,
     * if repayment interval = 10 secs, loan duration covered = 55 secs, repayment intervals covered = 5
     * @param _poolID address of the pool
     * @return scaled interest per second
     */

    function getInterestPerSecond(address _poolID) public view returns (uint256) {
        uint256 _activePrincipal = IPool(_poolID).getTotalSupply();
        uint256 _interestPerSecond = _activePrincipal.mul(repaymentConstants[_poolID].borrowRate).div(yearInSeconds);
        return _interestPerSecond;
    }

    // @return scaled instalments completed
    function getInstalmentsCompleted(address _poolID)
        public
        view
        returns (uint256)
    {
        uint256 _repaymentInterval =
            repaymentConstants[_poolID].repaymentInterval;
        uint256 _loanDurationCovered =
            repaymentVars[_poolID].loanDurationCovered;
        uint256 _instalmentsCompleted =
            _loanDurationCovered.div(_repaymentInterval).mul(10**30); // dividing exponents, returns whole number rounded down

        return _instalmentsCompleted;
    }

    // @return scaled
    function getInterestDueTillInstalmentDeadline(address _poolID) public view returns (uint256) {
        uint256 _interestPerSecond = getInterestPerSecond(_poolID);
        uint256 _nextInstalmentDeadline = getNextInstalmentDeadline(_poolID);
        uint256 _loanDurationCovered =
            repaymentVars[_poolID].loanDurationCovered;
        uint256 _interestDueTillInstalmentDeadline =
            (_nextInstalmentDeadline.sub(repaymentConstants[_poolID].loanStartTime).sub(_loanDurationCovered)).mul(
                _interestPerSecond
            ).div(10**30);
        return _interestDueTillInstalmentDeadline;
    }

    // return timestamp before which next instalment ends
    function getNextInstalmentDeadline(address _poolID) public view override returns (uint256) {
        uint256 _instalmentsCompleted = getInstalmentsCompleted(_poolID);
        if(_instalmentsCompleted == repaymentConstants[_poolID].numberOfTotalRepayments) {
            return 0;
        }
        uint256 _loanExtensionPeriod =
            repaymentVars[_poolID].loanExtensionPeriod;
        uint256 _repaymentInterval =
            repaymentConstants[_poolID].repaymentInterval;
        uint256 _loanStartTime = repaymentConstants[_poolID].loanStartTime;
        uint256 _nextInstalmentDeadline;

        if (_loanExtensionPeriod > _instalmentsCompleted) {
            _nextInstalmentDeadline = (
                (_instalmentsCompleted.add(10**30).add(10**30)).mul(_repaymentInterval).div(10**30)
            )
                .add(_loanStartTime);
        } else {
            _nextInstalmentDeadline = ((_instalmentsCompleted.add(10**30)).mul(_repaymentInterval).div(10**30)).add(
                _loanStartTime
            );
        }
        return _nextInstalmentDeadline;
    }

    function getCurrentInstalmentInterval(address _poolID) public view returns (uint256) {
        uint256 _instalmentsCompleted = getInstalmentsCompleted(_poolID);
        return _instalmentsCompleted.add(10**30);
    }

    function getCurrentLoanInterval(address _poolID) external view override returns (uint256) {
        uint256 _loanStartTime = repaymentConstants[_poolID].loanStartTime;
        uint256 _currentTime = block.timestamp.mul(10**30);
        uint256 _repaymentInterval = repaymentConstants[_poolID].repaymentInterval;
        uint256 _currentInterval = ((_currentTime.sub(_loanStartTime)).mul(10**30).div(_repaymentInterval)).add(10**30); // adding 10**30 to add 1

        return _currentInterval;
    }

    function isGracePenaltyApplicable(address _poolID) public view returns (bool) {
        //uint256 _loanStartTime = repaymentConstants[_poolID].loanStartTime;
        uint256 _repaymentInterval = repaymentConstants[_poolID].repaymentInterval;
        uint256 _currentTime = block.timestamp.mul(10**30);
        uint256 _gracePeriodFraction = repaymentConstants[_poolID].gracePeriodFraction;
        uint256 _nextInstalmentDeadline = getNextInstalmentDeadline(_poolID);
        uint256 _gracePeriodDeadline =
            _nextInstalmentDeadline.add(_gracePeriodFraction.mul(_repaymentInterval).div(10**30));

        require(_currentTime <= _gracePeriodDeadline, 'Borrower has defaulted');

        if (_currentTime <= _nextInstalmentDeadline) return false;
        else return true;
    }

    function didBorrowerDefault(address _poolID)
        public
        view
        override
        returns (bool)
    {
        uint256 _repaymentInterval =
            repaymentConstants[_poolID].repaymentInterval;
        uint256 _currentTime = block.timestamp.mul(10**30);
        uint256 _gracePeriodFraction =
            repaymentConstants[_poolID].gracePeriodFraction;
        uint256 _nextInstalmentDeadline = getNextInstalmentDeadline(_poolID);
        uint256 _gracePeriodDeadline =
            _nextInstalmentDeadline.add(
                _gracePeriodFraction.mul(_repaymentInterval).div(10**30)
            );
        if (_currentTime > _gracePeriodDeadline) return true;
        else return false;
    }

    /*
    function calculateRepayAmount(address poolID)
        public
        view
        override
        returns (uint256)
    {
        uint256 activePrincipal = IPool(poolID).getTotalSupply();
        // assuming repaymentInterval is in seconds
        //uint256 currentPeriod = (block.timestamp.sub(repaymentConstants[poolID].loanStartTime)).div(repaymentConstants[poolID].repaymentInterval);

        uint256 interestPerSecond =
            activePrincipal.mul(repaymentConstants[poolID].borrowRate).div(
                yearInSeconds
            );

        // uint256 periodEndTime = (currentPeriod.add(1)).mul(repaymentInterval);

        uint256 interestDueTillPeriodEnd =
            interestPerSecond.mul(
                (repaymentConstants[poolID].repaymentInterval).sub(
                    repaymentVars[poolID].repaymentPeriodCovered
                )
            );
        return interestDueTillPeriodEnd;
    }
*/

    function getInterestLeft(address _poolID) public view returns (uint256) {
        uint256 _interestPerSecond = getInterestPerSecond((_poolID));
        uint256 _loanDurationLeft =
            repaymentConstants[_poolID].loanDuration.sub(
                repaymentVars[_poolID].loanDurationCovered
            );
        uint256 _interestLeft =
            _interestPerSecond.mul(_loanDurationLeft).div(10**30); // multiplying exponents

        return _interestLeft;
    }

    function getInterestOverdue(address _poolID) public view returns (uint256) {
        require(repaymentVars[_poolID].isLoanExtensionActive == true, "No overdue");
        uint256 _instalmentsCompleted = getInstalmentsCompleted(_poolID);
        uint256 _interestPerSecond = getInterestPerSecond(_poolID);
        uint256 _interestOverdue =
            (
                (
                    (_instalmentsCompleted.add(10**30)).mul(
                        repaymentConstants[_poolID].repaymentInterval
                    ).div(10**30)
                    .sub(
                        repaymentVars[_poolID].loanDurationCovered
                    )
                )
            )
                .mul(_interestPerSecond).div(10**30);
        return _interestOverdue;
    }

    function repayAmount(address _poolID, uint256 _amount) public payable nonReentrant isPoolInitialized(_poolID) {
        IPool _pool = IPool(_poolID);
        _amount = _amount * 10**30;

        uint256 _loanStatus = _pool.getLoanStatus();
        require(_loanStatus == 1, 'Repayments:repayInterest Pool should be active.');

        uint256 _amountRequired = 0;
        uint256 _interestPerSecond = getInterestPerSecond(_poolID);
        // First pay off the overdue
        if (repaymentVars[_poolID].isLoanExtensionActive == true) {
            uint256 _interestOverdue = getInterestOverdue(_poolID);

            if (_amount >= _interestOverdue) {
                _amount = _amount.sub(_interestOverdue);
                _amountRequired = _amountRequired.add(_interestOverdue);
                repaymentVars[_poolID].isLoanExtensionActive = false; // deactivate loan extension flag
                repaymentVars[_poolID].loanDurationCovered = (getInstalmentsCompleted(_poolID).add(10**30)).mul(
                    repaymentConstants[_poolID].repaymentInterval
                ).div(10**30);
            } else {
                _amountRequired = _amountRequired.add(_amount);
                repaymentVars[_poolID].loanDurationCovered = repaymentVars[
                    _poolID
                ]
                    .loanDurationCovered
                    .add(_amount.mul(10**30).div(_interestPerSecond));
                _amount = 0;
            }
        }

        // Second pay off the interest
        if (_amount != 0) {
            uint256 _interestLeft = getInterestLeft(_poolID);
            bool _isBorrowerLate = isGracePenaltyApplicable(_poolID);

            // adding grace penalty if applicable
            if (_isBorrowerLate) {
                uint256 _penalty =
                    repaymentConstants[_poolID]
                        .gracePenaltyRate
                        .mul(getInterestDueTillInstalmentDeadline(_poolID))
                        .div(10**30);
                _amount = _amount.sub(_penalty);
                _amountRequired = _amountRequired.add(_penalty);
            }

            if (_amount < _interestLeft) {
                uint256 _loanDurationCovered =
                    _amount.mul(10**30).div(_interestPerSecond); // dividing exponents
                repaymentVars[_poolID].loanDurationCovered = repaymentVars[
                    _poolID
                ]
                    .loanDurationCovered
                    .add(_loanDurationCovered);
                _amountRequired = _amountRequired.add(_amount);
            } else {
                repaymentVars[_poolID].loanDurationCovered = repaymentConstants[_poolID].loanDuration; // full interest repaid
                _amount = _amount.sub(_interestLeft);
                _amountRequired = _amountRequired.add(_interestLeft);
            }
        }

        address _asset = repaymentConstants[_poolID].repayAsset;

        require(_amountRequired != 0, "Repayments::repayAmount not necessary");
        _amountRequired = _amountRequired.div(10**30);

        if (_asset == address(0)) {
            require(_amountRequired <= msg.value, 'Repayments::repayAmount amount does not match message value.');
            (bool success, ) = payable(address(_poolID)).call{ value: _amountRequired }("");
            require(success, "Transfer failed");
        } else {
            IERC20(_asset).safeTransferFrom(msg.sender, _poolID, _amountRequired);
        }

        if (_asset == address(0)) {
            if (msg.value > _amountRequired) {
                (bool success, ) = payable(address(msg.sender)).call{ value: msg.value.sub(_amountRequired) }("");
                require(success, "Transfer failed");
            }
        }
    }

    function repayPrincipal(address payable _poolID, uint256 _amount) public payable nonReentrant isPoolInitialized(_poolID) {
        IPool _pool = IPool(_poolID);
        uint256 _loanStatus = _pool.getLoanStatus();
        require(_loanStatus == 1, 'Repayments:repayPrincipal Pool should be active');

        require(
            repaymentVars[_poolID].isLoanExtensionActive == false,
            'Repayments:repayPrincipal Repayment overdue unpaid'
        );

        require(
            repaymentConstants[_poolID].loanDuration == repaymentVars[_poolID].loanDurationCovered,
            'Repayments:repayPrincipal Unpaid interest'
        );

        uint256 _activePrincipal = _pool.getTotalSupply();
        require(_amount == _activePrincipal, 'Repayments:repayPrincipal Amount should match the principal');

        address _asset = repaymentConstants[_poolID].repayAsset;

        if (_asset == address(0)) {
            require(_amount == msg.value, 'Repayments::repayAmount amount does not match message value.');
            (bool success, ) = _poolID.call{ value: _amount}("");
            require(success, "Transfer failed");
        } else {
            IERC20(_asset).safeTransferFrom(msg.sender, _poolID, _amount);
        }

        IPool(_poolID).closeLoan();
    }

    /*
    function getRepaymentPeriodCovered(address poolID) external view override returns(uint256) {
        return repaymentVars[poolID].repaymentPeriodCovered;
    }
    */
    function getTotalRepaidAmount(address poolID) external view override returns (uint256) {
        return repaymentVars[poolID].totalRepaidAmount;
    }

    function instalmentDeadlineExtended(address _poolID, uint256 _period) external override {
        require(msg.sender == poolFactory.extension(), 'Repayments::repaymentExtended - Invalid caller');

        repaymentVars[_poolID].isLoanExtensionActive = true;
        repaymentVars[_poolID].loanExtensionPeriod = _period;
    }

    function getInterestCalculationVars(address _poolID) external view override returns (uint256, uint256) {
        uint256 _interestPerSecond = getInterestPerSecond(_poolID);
        return (repaymentVars[_poolID].loanDurationCovered, _interestPerSecond);
    }

    function getGracePeriodFraction() external view override returns (uint256) {
        return gracePeriodFraction;
    }
}
