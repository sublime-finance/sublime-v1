// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.7.0;
pragma experimental ABIEncoderV2;

interface IRepayment {


     function initializePool(
        uint256 numberOfTotalRepayments,
        uint256 votingExtensionlength,
        uint256 gracepenaltyRate,
        uint256 gracePeriodInterval,
        uint256 loanDuration
    ) external ;


   

    function calculateRepayAmount(
        uint256 activeBorrowAmount,
        uint256 repaymentInterval,
        uint256 borrowRate,
        uint256 loanStartTime,
        uint256 nextDuePeriod,
        uint256 periodInWhichExtensionhasBeenRequested
    ) external view returns (uint256, uint256);

    function repayAmount(
        uint256 amount,
        uint256 activeBorrowAmount,
        uint256 repaymentInterval,
        uint256 borrowRate,
        uint256 loanStartTime,
        uint256 nextDuePeriod,
        uint256 periodInWhichExtensionhasBeenRequested
    ) external returns (uint256, uint256);


    function requestExtension(uint256 extensionVoteEndTime)
        external 
        returns (uint256);

    function voteOnExtension(
        address lender,
        uint256 lastVoteTime,
        uint256 extensionVoteEndTime,
        uint256 balance,
        uint256 totalExtensionSupport
    ) external returns (uint256, uint256);

    
    function resultOfVoting(
        uint256 totalExtensionSupport,
        uint256 extensionVoteEndTime,
        uint256 totalSupply,
        uint256 nextDuePeriod,
        uint256 repaymentInterval,
        uint256 loanStartTime,
        uint256 PeriodWhenExtensionIsPassed
    ) external returns (uint256,uint256);

}
