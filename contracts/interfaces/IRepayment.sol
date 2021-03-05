// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.7.0;
pragma experimental ABIEncoderV2;

interface IRepayment {


    function initializeRepayment(
        uint256 numberOfTotalRepayments,
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



}
