// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;
import '../interfaces/IPoolFactory.sol';

contract RepaymentStorage {
    address internal _owner;
    IPoolFactory poolFactory;
    address savingsAccount;

    enum LoanStatus {
        COLLECTION, //denotes collection period
        ACTIVE, // denotes the active loan
        CLOSED, // Loan is repaid and closed
        CANCELLED, // Cancelled by borrower
        DEFAULTED, // Repaymennt defaulted by  borrower
        TERMINATED // Pool terminated by admin
    }

    uint256 votingPassRatio;
    uint256 gracePenaltyRate;
    uint256 gracePeriodFraction; // fraction of the repayment interval
    uint256 constant yearInSeconds = 365 days;

    struct RepaymentVars {
        uint256 totalRepaidAmount;
        uint256 repaymentPeriodCovered;
        bool isLoanExtensionActive;
        uint256 loanDurationCovered;
        uint256 nextDuePeriod;
        uint256 nInstalmentsFullyPaid;
        uint256 loanExtensionPeriod; // period for which the extension was granted, ie, if loanExtensionPeriod is 7 * 10**30, 7th instalment can be repaid by 8th instalment deadline
    }

    struct RepaymentConstants {
        uint256 numberOfTotalRepayments; // using it to check if RepaymentDetails Exists as repayment Interval!=0 in any case
        uint256 gracePenaltyRate;
        uint256 gracePeriodFraction;
        uint256 loanDuration;
        uint256 repaymentInterval;
        uint256 borrowRate;
        //uint256 repaymentDetails;
        uint256 loanStartTime;
        address repayAsset;
        address savingsAccount;
    }

    mapping(address => RepaymentVars) public repaymentVars;
    mapping(address => RepaymentConstants) public repaymentConstants;
}
