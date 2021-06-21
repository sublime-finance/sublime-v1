import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { assert, expect } from "chai";

import {
  aaveYieldParams,
  depositValueToTest,
  zeroAddress,
  Binance7 as binance7,
  WhaleAccount as whaleAccount,
  DAI_Yearn_Protocol_Address,
  testPoolFactoryParams,
  createPoolParams,
  ChainLinkAggregators,
  OperationalAmounts,
} from "../../utils/constants";
import DeployHelper from "../../utils/deploys";

import { SavingsAccount } from "../../typechain/SavingsAccount";
import { StrategyRegistry } from "../../typechain/StrategyRegistry";
import {
  getPoolAddress,
  getRandomFromArray,
  incrementChain,
} from "../../utils/helpers";
import { Address } from "hardhat-deploy/dist/types";
import { AaveYield } from "../../typechain/AaveYield";
import { YearnYield } from "../../typechain/YearnYield";
import { CompoundYield } from "../../typechain/CompoundYield";
import { Pool } from "../../typechain/Pool";
import { Verification } from "../../typechain/Verification";
import { PoolFactory } from "../../typechain/PoolFactory";
import { ERC20 } from "../../typechain/ERC20";
import { PriceOracle } from "../../typechain/PriceOracle";
import { Extension } from "../../typechain/Extension";

import { Contracts } from "../../existingContracts/compound.json";
import { sha256 } from "@ethersproject/sha2";
import { PoolToken } from "../../typechain/PoolToken";
import { Repayments } from "../../typechain/Repayments";
import { ContractTransaction } from "@ethersproject/contracts";
import { getContractAddress } from "@ethersproject/address";

describe("Pool Collection stage", async () => {
    let savingsAccount: SavingsAccount;
    let strategyRegistry: StrategyRegistry;

    let mockCreditLines: SignerWithAddress;
    let proxyAdmin: SignerWithAddress;
    let admin: SignerWithAddress;
    let borrower: SignerWithAddress;
    let lender: SignerWithAddress;
    let lender1: SignerWithAddress;

    let extenstion: Extension;
    let poolImpl: Pool;
    let poolTokenImpl: PoolToken;
    let poolFactory: PoolFactory;
    let repaymentImpl: Repayments;

    let aaveYield: AaveYield;
    let yearnYield: YearnYield;
    let compoundYield: CompoundYield;

    let BatTokenContract: ERC20;
    let LinkTokenContract: ERC20;
    let DaiTokenContract: ERC20;

    let verification: Verification;
    let priceOracle: PriceOracle;

    let Binance7: any;
    let WhaleAccount: any;

    before(async () => {
        [proxyAdmin, admin, mockCreditLines, borrower, lender, lender1] = await ethers.getSigners();
        const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
        savingsAccount = await deployHelper.core.deploySavingsAccount();
        strategyRegistry = await deployHelper.core.deployStrategyRegistry();

        //initialize
        savingsAccount.initialize(
            admin.address,
            strategyRegistry.address,
            mockCreditLines.address
        );
        strategyRegistry.initialize(admin.address, 10);

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [binance7],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [whaleAccount],
        });

        await admin.sendTransaction({
            to: whaleAccount,
            value: ethers.utils.parseEther("100"),
        });

        Binance7 = await ethers.provider.getSigner(binance7);
        WhaleAccount = await ethers.provider.getSigner(whaleAccount);

        BatTokenContract = await deployHelper.mock.getMockERC20(Contracts.BAT);
        await BatTokenContract.connect(Binance7).transfer(
            admin.address,
            BigNumber.from("10").pow(23)
        ); // 10,000 BAT tokens

        LinkTokenContract = await deployHelper.mock.getMockERC20(Contracts.LINK);
        await LinkTokenContract.connect(Binance7).transfer(
            admin.address,
            BigNumber.from("10").pow(23)
        ); // 10,000 LINK tokens

        DaiTokenContract = await deployHelper.mock.getMockERC20(Contracts.DAI);
        await DaiTokenContract.connect(WhaleAccount).transfer(
            admin.address,
            BigNumber.from("10").pow(23)
        ); // 10,000 DAI

        aaveYield = await deployHelper.core.deployAaveYield();
        await aaveYield
            .connect(admin)
            .initialize(
                admin.address,
                savingsAccount.address,
                aaveYieldParams._wethGateway,
                aaveYieldParams._protocolDataProvider,
                aaveYieldParams._lendingPoolAddressesProvider
            );

        await strategyRegistry.connect(admin).addStrategy(aaveYield.address);

        yearnYield = await deployHelper.core.deployYearnYield();
        await yearnYield.initialize(admin.address, savingsAccount.address);
        await strategyRegistry.connect(admin).addStrategy(yearnYield.address);
        await yearnYield
            .connect(admin)
            .updateProtocolAddresses(
                DaiTokenContract.address,
                DAI_Yearn_Protocol_Address
            );

        compoundYield = await deployHelper.core.deployCompoundYield();
        await compoundYield.initialize(admin.address, savingsAccount.address);
        await strategyRegistry.connect(admin).addStrategy(compoundYield.address);
        await compoundYield
            .connect(admin)
            .updateProtocolAddresses(Contracts.DAI, Contracts.cDAI);

        verification = await deployHelper.helper.deployVerification();
        await verification.connect(admin).initialize(admin.address);
        await verification
            .connect(admin)
            .registerUser(borrower.address, sha256(Buffer.from("Borrower")));

        priceOracle = await deployHelper.helper.deployPriceOracle();
        await priceOracle.connect(admin).initialize(admin.address);
        await priceOracle
            .connect(admin)
            .setfeedAddress(
                Contracts.LINK,
                Contracts.DAI,
                ChainLinkAggregators["LINK/USD"],
                ChainLinkAggregators["DAI/USD"]
            );

        poolFactory = await deployHelper.pool.deployPoolFactory();
        extenstion = await deployHelper.pool.deployExtenstion();
        await extenstion.connect(admin).initialize(poolFactory.address);
        let {
            _collectionPeriod,
            _marginCallDuration,
            _collateralVolatilityThreshold,
            _gracePeriodPenaltyFraction,
            _liquidatorRewardFraction,
            _matchCollateralRatioInterval,
            _poolInitFuncSelector,
            _poolTokenInitFuncSelector,
            _poolCancelPenalityFraction
        } = testPoolFactoryParams;
        await poolFactory
            .connect(admin)
            .initialize(
                verification.address,
                strategyRegistry.address,
                admin.address,
                _collectionPeriod,
                _matchCollateralRatioInterval,
                _marginCallDuration,
                _collateralVolatilityThreshold,
                _gracePeriodPenaltyFraction,
                _poolInitFuncSelector,
                _poolTokenInitFuncSelector,
                _liquidatorRewardFraction,
                priceOracle.address,
                savingsAccount.address,
                extenstion.address,
                _poolCancelPenalityFraction
            );
        await poolFactory
            .connect(admin)
            .updateSupportedBorrowTokens(Contracts.DAI, true);

        await poolFactory
            .connect(admin)
            .updateSupportedCollateralTokens(Contracts.LINK, true);

        poolImpl = await deployHelper.pool.deployPool();
        poolTokenImpl = await deployHelper.pool.deployPoolToken();
        repaymentImpl = await deployHelper.pool.deployRepayments();

        await poolFactory
            .connect(admin)
            .setImplementations(
                poolImpl.address,
                repaymentImpl.address,
                poolTokenImpl.address
            );
    });

    describe("Pool that borrows ERC20 with ERC20 as collateral", async () => {
        let pool: Pool;
        let poolToken: PoolToken;
        let collateralToken: ERC20;
        let borrowToken: ERC20;
        beforeEach(async () => {
            let deployHelper: DeployHelper = new DeployHelper(borrower);
            collateralToken = await deployHelper.mock.getMockERC20(
                Contracts.LINK
            );

            borrowToken = await deployHelper.mock.getMockERC20(
                Contracts.DAI
            );

            const salt = sha256(Buffer.from("borrower"+Math.random()*1000000));

            let generatedPoolAddress: Address = await getPoolAddress(
                borrower.address,
                Contracts.DAI,
                Contracts.LINK,
                aaveYield.address,
                poolFactory.address,
                salt,
                poolImpl.address,
                false
            );

            const nonce = (await poolFactory.provider.getTransactionCount(poolFactory.address)) + 1;
            let newPoolToken: string = getContractAddress({
                from: poolFactory.address,
                nonce,
            });

            let {
                _poolSize,
                _minborrowAmount,
                _collateralRatio,
                _borrowRate,
                _repaymentInterval,
                _noOfRepaymentIntervals,
                _collateralAmount,
            } = createPoolParams;

            await collateralToken
                .connect(admin)
                .transfer(borrower.address, _collateralAmount); // Transfer quantity to borrower

            await collateralToken.connect(borrower).approve(
                generatedPoolAddress,
                _collateralAmount
            );

            await expect(
                poolFactory
                    .connect(borrower)
                    .createPool(
                        _poolSize,
                        _minborrowAmount,
                        Contracts.DAI,
                        Contracts.LINK,
                        _collateralRatio,
                        _borrowRate,
                        _repaymentInterval,
                        _noOfRepaymentIntervals,
                        aaveYield.address,
                        _collateralAmount,
                        false,
                        salt
                    )
            )
            .to.emit(poolFactory, "PoolCreated")
            .withArgs(generatedPoolAddress, borrower.address, newPoolToken);

            poolToken = await deployHelper.pool.getPoolToken(
                newPoolToken
            );

            expect(await poolToken.name()).eq("Open Borrow Pool Tokens");
            expect(await poolToken.symbol()).eq("OBPT");
            expect(await poolToken.decimals()).eq(18);

            pool = await deployHelper.pool.getPool(generatedPoolAddress);
        });

        it("Lend Tokens directly", async () => {
            const amount = OperationalAmounts._amountLent.div(10);
            const poolTokenBalanceBefore = await poolToken.balanceOf(lender.address);
            const poolTokenTotalSupplyBefore = await poolToken.totalSupply();
            await borrowToken.connect(admin).transfer(
                lender.address,
                amount
            );
            await borrowToken.connect(lender).approve(
                pool.address,
                amount
            );
            
            const lendExpect = expect(
                pool.connect(lender).lend(lender.address, amount, false)
            );

            await lendExpect.to.emit(pool, "LiquiditySupplied")
            .withArgs(amount, lender.address);

            await lendExpect.to.emit(poolToken, "Transfer")
            .withArgs(zeroAddress, lender.address, amount);

            const poolTokenBalanceAfter = await poolToken.balanceOf(lender.address);
            const poolTokenTotalSupplyAfter = await poolToken.totalSupply();
            assert(poolTokenBalanceAfter.toString() == poolTokenBalanceBefore.add(amount).toString(), `Pool tokens not minted correctly. amount: ${amount} Expected: ${poolTokenBalanceBefore.add(amount)} Actual: ${poolTokenBalanceAfter}`);
            assert(poolTokenTotalSupplyAfter.toString() == poolTokenTotalSupplyBefore.add(amount).toString(), `Pool token supply not correct. amount: ${amount} Expected: ${poolTokenTotalSupplyBefore.add(amount)} Actual: ${poolTokenTotalSupplyBefore}`);
        });

        it("Lend Tokens from savings account by depositing with same account in savingsAccount", async () => {
            const amount = OperationalAmounts._amountLent.div(10);
            await borrowToken.connect(admin).transfer(
                lender.address,
                amount
            );
            await borrowToken.connect(lender).approve(aaveYield.address, amount);
            await savingsAccount.connect(lender).depositTo(amount, borrowToken.address, aaveYield.address, lender.address);

            const poolTokenBalanceBefore = await poolToken.balanceOf(lender.address);
            const poolTokenTotalSupplyBefore = await poolToken.totalSupply();
            await savingsAccount.connect(lender).approve(borrowToken.address, pool.address, amount);

            const lendExpect = expect(
                pool.connect(lender).lend(lender.address, amount, true)
            );

            await lendExpect.to.emit(pool, "LiquiditySupplied")
            .withArgs(amount, lender.address);

            await lendExpect.to.emit(poolToken, "Transfer")
            .withArgs(zeroAddress, lender.address, amount);

            const poolTokenBalanceAfter = await poolToken.balanceOf(lender.address);
            const poolTokenTotalSupplyAfter = await poolToken.totalSupply();
            assert(poolTokenBalanceAfter.toString() == poolTokenBalanceBefore.add(amount).toString(), `Pool tokens not minted correctly. amount: ${amount} Expected: ${poolTokenBalanceBefore.add(amount)} Actual: ${poolTokenBalanceAfter}`);
            assert(poolTokenTotalSupplyAfter.toString() == poolTokenTotalSupplyBefore.add(amount).toString(), `Pool token supply not correct. amount: ${amount} Expected: ${poolTokenTotalSupplyBefore.add(amount)} Actual: ${poolTokenTotalSupplyBefore}`);
        });

        it("Lend Tokens from savings account by depositing and lending with different account in savingsAccount", async () => {
            const amount = OperationalAmounts._amountLent.div(10);
            await borrowToken.connect(admin).transfer(
                lender1.address,
                amount
            );
            await borrowToken.connect(lender1).approve(aaveYield.address, amount);
            await savingsAccount.connect(lender1).depositTo(amount, borrowToken.address, aaveYield.address, lender1.address);

            const poolTokenBalanceBefore = await poolToken.balanceOf(lender.address);
            const poolTokenTotalSupplyBefore = await poolToken.totalSupply();
            await savingsAccount.connect(lender1).approve(borrowToken.address, pool.address, amount);

            const lendExpect = expect(
                pool.connect(lender1).lend(lender.address, amount, true)
            );

            await lendExpect.to.emit(pool, "LiquiditySupplied")
            .withArgs(amount, lender.address);

            await lendExpect.to.emit(poolToken, "Transfer")
            .withArgs(zeroAddress, lender.address, amount);

            const poolTokenBalanceAfter = await poolToken.balanceOf(lender.address);
            const poolTokenTotalSupplyAfter = await poolToken.totalSupply();
            assert(poolTokenBalanceAfter.toString() == poolTokenBalanceBefore.add(amount).toString(), `Pool tokens not minted correctly. amount: ${amount} Expected: ${poolTokenBalanceBefore.add(amount)} Actual: ${poolTokenBalanceAfter}`);
            assert(poolTokenTotalSupplyAfter.toString() == poolTokenTotalSupplyBefore.add(amount).toString(), `Pool token supply not correct. amount: ${amount} Expected: ${poolTokenTotalSupplyBefore.add(amount)} Actual: ${poolTokenTotalSupplyBefore}`);
        });
    });
});