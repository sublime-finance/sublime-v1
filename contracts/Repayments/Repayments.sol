// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.7.0;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/IRepayment.sol";
import "./RepaymentStorage.sol";

contract Repayments is RepaymentStorage,IRepayment {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;


    event votingPassed(uint256 nextDuePeriod,uint256 PeriodWhenExtensionIsPassed);
    event votingFailed(uint256 nextDuePeriod);
    event lenderVoted(address lender,uint256 totalExtensionSupport,uint256 lastVoteTime);
    event extensionRequested(uint256 extensionVoteEndTime);

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



    function requestExtension(uint256 _extensionVoteEndTime)
        external override isPoolInitialized
        returns (uint256)
    {
        require(
            block.timestamp > _extensionVoteEndTime,
            "Repayments::requestExtension - Extension requested already"
        );
        _extensionVoteEndTime = (block.timestamp).add(repaymentDetails[msg.sender].votingExtensionlength);
        emit extensionRequested(_extensionVoteEndTime);
        return _extensionVoteEndTime;
    }

    function voteOnExtension(
        address _lender,
        uint256 _lastVoteTime,
        uint256 _extensionVoteEndTime,
        uint256 _balance,
        uint256 _totalExtensionSupport
    ) external override isPoolInitialized returns (uint256, uint256) {
        require(
            block.timestamp < _extensionVoteEndTime,
            "Repayments::voteOnExtension - Voting is over"
        );
        require(
            _lastVoteTime < _extensionVoteEndTime.sub(repaymentDetails[msg.sender].votingExtensionlength),
            "Repayments::voteOnExtension - you have already voted"
        );
        _lastVoteTime = block.timestamp;
        _totalExtensionSupport = _totalExtensionSupport.add(_balance);
        emit lenderVoted(_lender,_totalExtensionSupport,_lastVoteTime);
        return (_lastVoteTime, _totalExtensionSupport);

    }

    function resultOfVoting(
        uint256 _totalExtensionSupport,
        uint256 _extensionVoteEndTime,
        uint256 _totalSupply,
        uint256 _nextDuePeriod,
        uint256 _repaymentInterval,
        uint256 _loanStartTime,
        uint256 _PeriodWhenExtensionIsPassed
    ) external override isPoolInitialized returns (uint256,uint256) {

        require(block.timestamp > _extensionVoteEndTime, "Repayments::resultOfVoting - Voting is not over");

        // Assuming votingPassRatio a uint in range of 1-100 (can be changed to 10^18 or some large value)
        if (((_totalExtensionSupport).mul(repaymentDetails[msg.sender].votingPassRatio)).div(100) >= _totalSupply) {
            _PeriodWhenExtensionIsPassed = calculateCurrentPeriod(_loanStartTime,_repaymentInterval);
            _nextDuePeriod = _nextDuePeriod.add(1);
            emit votingPassed(_nextDuePeriod,_PeriodWhenExtensionIsPassed);

        }
        else{
            emit votingFailed(_nextDuePeriod);
        }
        return (_PeriodWhenExtensionIsPassed,_nextDuePeriod);
        
    }

    function updatePoolFactory(address _poolFactory) external onlyOwner {
        poolFactory = IPoolFactory(_poolFactory);
    }

    function updateVotingExtensionlength(uint256 _votingExtensionPeriod) external onlyOwner {
        votingExtensionlength = _votingExtensionPeriod;
    }

    function updateVotingPassRatio(uint256 _votingPassRatio) external onlyOwner {
        votingPassRatio = _votingPassRatio;
    }
}
