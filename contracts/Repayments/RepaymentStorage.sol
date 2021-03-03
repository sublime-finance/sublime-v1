// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";


contract RepaymentStorage is OwnableUpgradeable {
    address internal _owner;
    
    uint256 public constant yearSeconds = 365 days;
    struct RepaymentDetails {
        uint256 numberOfTotalRepayments; // using it to check if RepaymentDetails Exists as repayment Interval!=0 in any case
        uint256 votingExtensionlength;
        uint256 amountPaidforInstallment;
        uint256 gracepenaltyRate;
        uint256 gracePeriodInterval;
        uint256 totalRepaidAmount;
        uint256 loanDuration;
        uint256 extraGracePeriodsTaken;
        uint256 votingPassRatio;
    }

    mapping(address => RepaymentDetails) repaymentDetails;    

}
