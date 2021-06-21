import { BigNumber } from "@ethersproject/bignumber";
import { Address } from "hardhat-deploy/dist/types";

export const depositValueToTest: BigNumber = BigNumber.from(
  "1000000000000000000"
); // 1 ETH (or) 10^18 Tokens
export const zeroAddress: Address =
  "0x0000000000000000000000000000000000000000";

export const aaveYieldParams = {
  _wethGateway: "0xDcD33426BA191383f1c9B431A342498fdac73488",
  _protocolDataProvider: "0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d",
  _lendingPoolAddressesProvider: "0xb53c1a33016b2dc2ff3653530bff1848a515c8c5",
};

export const ETH_Yearn_Protocol_Address =
  "0xe1237aa7f535b0cc33fd973d66cbf830354d16c7";

export const Binance7 = "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8";
export const WhaleAccount = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503";
export const DAI_Yearn_Protocol_Address =
  "0xacd43e627e64355f1861cec6d3a6688b31a6f952";

export const aLink = "0xa06bC25B5805d5F8d82847D191Cb4Af5A3e873E0";

const collateralRatio = BigNumber.from(275);

export const createPoolParams = {
  _poolSize: BigNumber.from(10000000),
  _borrowAmountRequested: depositValueToTest,
  _minborrowAmount: BigNumber.from(1),
  _idealCollateralRatio: collateralRatio,
  _collateralRatio: collateralRatio,
  _borrowRate: BigNumber.from(5),
  _repaymentInterval: BigNumber.from(100),
  _noOfRepaymentIntervals: BigNumber.from(25),
  _collateralAmount: depositValueToTest.mul(collateralRatio).mul(2).div(100),
  _loanWithdrawalDuration: BigNumber.from(15000000),
  _collectionPeriod: BigNumber.from(5000000),
};

// address _borrowTokenType,
// address _collateralTokenType,
// address _poolSavingsStrategy,
// bool _transferFromSavingsAccount,
// bytes32 _salt

export const testPoolFactoryParams = {
  _collectionPeriod: BigNumber.from(10000),
  _matchCollateralRatioInterval: BigNumber.from(200),
  _marginCallDuration: BigNumber.from(300),
  _collateralVolatilityThreshold: BigNumber.from(25),
  _gracePeriodPenaltyFraction: BigNumber.from(25),
  _liquidatorRewardFraction: BigNumber.from(15),
  _poolInitFuncSelector: "0x272edaf2",
  _poolTokenInitFuncSelector: "0x077f224a",
  _poolCancelPenalityFraction: BigNumber.from(10000000)
};

// Pool Factory inputs tro be manually added
// bytes4 _poolInitFuncSelector,
// bytes4 _poolTokenInitFuncSelector,

// Pool inputs to be manullay added
// address _borrower,
// address _borrowAsset,
// address _collateralAsset,
// address _poolSavingsStrategy,
// bool _transferFromSavingsAccount,

export const OperationalAmounts = {
  _amountLent: BigNumber.from(1000000),
};

export const ChainLinkAggregators = {
  "LINK/USD": "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
  "DAI/USD": "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9",
};
