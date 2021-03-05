// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.7.0;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/IRepayment.sol";
import "./RepaymentStorage.sol";

contract Repayments is RepaymentStorage,IRepayment {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;



    modifier isPoolInitialized() {
        require(
             repaymentDetails[msg.sender].numberOfTotalRepayments !=0,
            "Repayments::requestExtension - Pool is not Initiliazed"
        );
        _;
    }

    modifier onlyValidPool {
        require(poolFactory.registry(msg.sender), "Repayments::onlyValidPool - Invalid Pool");
        _;
    }

    function initialize(address _poolFactory, uint256 _votingExtensionlength, uint256 _votingPassRatio)
        public
        initializer 
    {
        // _votingExtensionlength - should enforce conditions with repaymentInterval
        __Ownable_init();
        poolFactory = IPoolFactory(_poolFactory);
        votingExtensionlength = _votingExtensionlength;
        votingPassRatio = _votingPassRatio;
    }

    function initializeRepayment(
        uint256 numberOfTotalRepayments,
        uint256 repaymentInterval
    ) external onlyValidPool {
        repaymentDetails[msg.sender].gracePenaltyRate = gracePenaltyRate;
        repaymentDetails[msg.sender].gracePeriodFraction = gracePeriodFraction;
        repaymentDetails[msg.sender].numberOfTotalRepayments = numberOfTotalRepayments;
        repaymentDetails[msg.sender].loanDuration = repaymentInterval.mul(numberOfTotalRepayments);
    }


    function calculateCurrentPeriod(
        uint256 _loanStartTime,
        uint256 _repaymentInterval
    ) public view returns (uint256) {
        uint256 _currentPeriod =
            (block.timestamp.sub(_loanStartTime)).div(_repaymentInterval);
        return _currentPeriod;
    }

    function interestPerSecond(uint256 _principle, uint256 _borrowRate)
        public
        view
        returns (uint256)
    {
        uint256 _interest = ((_principle).mul(_borrowRate)).div(365 days);
        return _interest;
        
    }

    function amountPerPeriodBorrower(
        uint256 _activeBorrowAmount,
        uint256 _repaymentInterval,
        uint256 _borrowRate
    ) public view returns (uint256) {

        uint256 _amountPerPeriod =
            interestPerSecond(_activeBorrowAmount, _borrowRate).mul(
                _repaymentInterval
            );
        return _amountPerPeriod;
    }

    function calculateRepayAmount(
        uint256 activeBorrowAmount,
        uint256 repaymentInterval,
        uint256 borrowRate,
        uint256 loanStartTime,
        uint256 nextDuePeriod,
        uint256 periodInWhichExtensionhasBeenRequested
    ) public view override isPoolInitialized returns (uint256, uint256) {
        
    }

    function repayAmount(
        uint256 amount,
        uint256 activeBorrowAmount,
        uint256 repaymentInterval,
        uint256 borrowRate,
        uint256 loanStartTime,
        uint256 nextDuePeriod,
        uint256 periodInWhichExtensionhasBeenRequested
    ) public override isPoolInitialized returns (uint256, uint256) {
        
    }

    // function TotalDueamountLeft() public view{
    //     uint256 intervalsLeft = totalNumberOfRepayments-calculateCurrentPeriod();
    //     return(intervalLeft.mul(amountPerPeriod()));
    // }



    
}
