// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;

interface IPoolFactory {

    function savingsAccount() external view returns(address);
    function owner() external view returns(address);
    function registry(address pool) external view returns(bool);
    function votingExtensionlength() external view returns(uint256);
    function votingPassRatio() external view returns(uint256);
    function priceOracle() external view returns (address);
    function repaymentImpl() external view returns (address);
    function collectionPeriod() external view returns (uint256);
    function matchCollateralRatioInterval() external view returns (uint256);
    function marginCallDuration() external view returns (uint256);
    function collateralVolatilityThreshold() external view returns (uint256);
    function gracePeriodPenaltyFraction() external view returns (uint256);
    function liquidatorRewardFraction() external view returns (uint256);
}