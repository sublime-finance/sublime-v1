import { ethers, network } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { assert, expect } from 'chai';

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
    repaymentParams,
} from '../../utils/constants';
import DeployHelper from '../../utils/deploys';

import { SavingsAccount } from '../../typechain/SavingsAccount';
import { StrategyRegistry } from '../../typechain/StrategyRegistry';
import { getPoolAddress, getRandomFromArray } from '../../utils/helpers';
import { incrementChain, timeTravel, blockTravel } from '../../utils/time';
import { Address } from 'hardhat-deploy/dist/types';
import { AaveYield } from '../../typechain/AaveYield';
import { YearnYield } from '../../typechain/YearnYield';
import { CompoundYield } from '../../typechain/CompoundYield';
import { Pool } from '../../typechain/Pool';
import { Verification } from '../../typechain/Verification';
import { PoolFactory } from '../../typechain/PoolFactory';
import { ERC20 } from '../../typechain/ERC20';
import { PriceOracle } from '../../typechain/PriceOracle';
import { Extension } from '../../typechain/Extension';

import { Contracts } from '../../existingContracts/compound.json';
import { sha256 } from '@ethersproject/sha2';
import { PoolToken } from '../../typechain/PoolToken';
import { Repayments } from '../../typechain/Repayments';
import { ContractTransaction } from '@ethersproject/contracts';
import { getContractAddress } from '@ethersproject/address';
import { IYield } from '@typechain/IYield';

describe('Pool Borrow Withdrawal stage', async () => {
    let savingsAccount: SavingsAccount;
    let strategyRegistry: StrategyRegistry;

    let mockCreditLines: SignerWithAddress;
    let proxyAdmin: SignerWithAddress;
    let admin: SignerWithAddress;
    let borrower: SignerWithAddress;
    let lender: SignerWithAddress;
    let lender1: SignerWithAddress;
    let random: SignerWithAddress;

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
        [proxyAdmin, admin, mockCreditLines, borrower, lender, lender1, random] = await ethers.getSigners();
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
            method: 'hardhat_impersonateAccount',
            params: [binance7],
        });

        await network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [whaleAccount],
        });

        await admin.sendTransaction({
            to: whaleAccount,
            value: ethers.utils.parseEther('100'),
        });

        Binance7 = await ethers.provider.getSigner(binance7);
        WhaleAccount = await ethers.provider.getSigner(whaleAccount);

        BatTokenContract = await deployHelper.mock.getMockERC20(Contracts.BAT);
        await BatTokenContract.connect(Binance7).transfer(
            admin.address,
            BigNumber.from('10').pow(23)
        ); // 10,000 BAT tokens

        LinkTokenContract = await deployHelper.mock.getMockERC20(
            Contracts.LINK
        );
        await LinkTokenContract.connect(Binance7).transfer(
            admin.address,
            BigNumber.from('10').pow(23)
        ); // 10,000 LINK tokens

        DaiTokenContract = await deployHelper.mock.getMockERC20(Contracts.DAI);
        await DaiTokenContract.connect(WhaleAccount).transfer(
            admin.address,
            BigNumber.from('10').pow(23)
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
        await strategyRegistry
            .connect(admin)
            .addStrategy(compoundYield.address);
        await compoundYield
            .connect(admin)
            .updateProtocolAddresses(Contracts.DAI, Contracts.cDAI);

        verification = await deployHelper.helper.deployVerification();
        await verification.connect(admin).initialize(admin.address);
        await verification
            .connect(admin)
            .registerUser(borrower.address, sha256(Buffer.from('Borrower')));

        priceOracle = await deployHelper.helper.deployPriceOracle();
        await priceOracle.connect(admin).initialize(admin.address);
        await priceOracle
            .connect(admin)
            .setfeedAddress(Contracts.LINK, ChainLinkAggregators['LINK/USD']);
        await priceOracle
            .connect(admin)
            .setfeedAddress(Contracts.DAI, ChainLinkAggregators['DAI/USD']);

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
            _poolCancelPenalityFraction,
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
            .updateSupportedBorrowTokens(Contracts.LINK, true);

        await poolFactory
            .connect(admin)
            .updateSupportedCollateralTokens(Contracts.DAI, true);

        poolImpl = await deployHelper.pool.deployPool();
        poolTokenImpl = await deployHelper.pool.deployPoolToken();
        repaymentImpl = await deployHelper.pool.deployRepayments();

        await repaymentImpl
            .connect(admin)
            .initialize(
                admin.address,
                poolFactory.address,
                repaymentParams.votingPassRatio,
                savingsAccount.address
            );

        await poolFactory
            .connect(admin)
            .setImplementations(
                poolImpl.address,
                repaymentImpl.address,
                poolTokenImpl.address
            );
    });

    describe('Pool that borrows ERC20 with ERC20 as collateral', async () => {
        let pool: Pool;
        let poolToken: PoolToken;
        let collateralToken: ERC20;
        let borrowToken: ERC20;
        let amount: BigNumber;

        describe('Amount lent < minBorrowAmount at the end of collection period', async () => {
            let poolStrategy: IYield;
            beforeEach(async () => {
                let deployHelper: DeployHelper = new DeployHelper(borrower);
                collateralToken = await deployHelper.mock.getMockERC20(
                    Contracts.DAI
                );

                borrowToken = await deployHelper.mock.getMockERC20(
                    Contracts.LINK
                );
                poolStrategy = await deployHelper.mock.getYield(
                    compoundYield.address
                );

                const salt = sha256(
                    Buffer.from('borrower' + Math.random() * 10000000)
                );

                let generatedPoolAddress: Address = await getPoolAddress(
                    borrower.address,
                    Contracts.LINK,
                    Contracts.DAI,
                    poolStrategy.address,
                    poolFactory.address,
                    salt,
                    poolImpl.address,
                    false
                );

                const nonce =
                    (await poolFactory.provider.getTransactionCount(
                        poolFactory.address
                    )) + 1;
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

                await collateralToken
                    .connect(borrower)
                    .approve(generatedPoolAddress, _collateralAmount);

                await poolFactory
                    .connect(borrower)
                    .createPool(
                        _poolSize,
                        _minborrowAmount,
                        Contracts.LINK,
                        Contracts.DAI,
                        _collateralRatio,
                        _borrowRate,
                        _repaymentInterval,
                        _noOfRepaymentIntervals,
                        poolStrategy.address,
                        _collateralAmount,
                        false,
                        salt
                    );

                poolToken = await deployHelper.pool.getPoolToken(newPoolToken);

                pool = await deployHelper.pool.getPool(generatedPoolAddress);

                amount = createPoolParams._minborrowAmount.sub(10);
                await borrowToken
                    .connect(admin)
                    .transfer(lender.address, amount);
                await borrowToken.connect(lender).approve(pool.address, amount);
                await pool.connect(lender).lend(lender.address, amount, false);

                const { loanStartTime } = await pool.poolConstants();
                await blockTravel(
                    network,
                    parseInt(loanStartTime.add(1).toString())
                );
            });

            it('Lender pool tokens should be transferrable', async () => {
                const balance = await poolToken.balanceOf(lender.address);
                const balanceBefore = await poolToken.balanceOf(
                    lender1.address
                );
                await poolToken
                    .connect(lender)
                    .transfer(lender1.address, balance);
                const balanceAfter = await poolToken.balanceOf(lender1.address);
                assert(
                    balanceBefore.add(balance).toString() ==
                        balanceAfter.toString(),
                    'Pool token transfer not working'
                );
                const balanceSenderAfter = await poolToken.balanceOf(
                    lender.address
                );
                assert(
                    balanceSenderAfter.toString() == '0',
                    `Pool token not getting transferred correctly. Expected: 0, actual: ${balanceSenderAfter.toString()}`
                );
            });

            it('Lender cannot withdraw tokens', async () => {
                await expect(
                    pool.connect(lender).withdrawLiquidity()
                ).to.revertedWith('24');
            });

            it("Borrower can't withdraw", async () => {
                await expect(
                    pool.connect(borrower).withdrawBorrowedAmount()
                ).to.revertedWith('');
            });

            it('Borrower can cancel pool without penality', async () => {
                const collateralBalanceBorrowerSavings =
                    await savingsAccount.userLockedBalance(
                        borrower.address,
                        collateralToken.address,
                        poolStrategy.address
                    );
                const collateralBalancePoolSavings =
                    await savingsAccount.userLockedBalance(
                        pool.address,
                        collateralToken.address,
                        poolStrategy.address
                    );
                const { baseLiquidityShares } = await pool.poolVars();
                await pool.connect(borrower).cancelPool();
                const collateralBalanceBorrowerSavingsAfter = await savingsAccount.userLockedBalance(borrower.address, collateralToken.address, poolStrategy.address);
                const collateralBalancePoolSavingsAfter = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                assert(
                    collateralBalanceBorrowerSavingsAfter.sub(collateralBalanceBorrowerSavings).toString() == baseLiquidityShares.sub(1).toString(),
                    `Borrower didn't receive collateral back correctly Actual: ${collateralBalanceBorrowerSavingsAfter.sub(collateralBalanceBorrowerSavings).toString()}, Expected: ${baseLiquidityShares.toString()}`
                );
                assert(
                    collateralBalancePoolSavings.sub(collateralBalancePoolSavingsAfter).toString() == baseLiquidityShares.sub(1).toString(),
                    `Pool shares didn't decrease correctly Actual: ${collateralBalancePoolSavings.sub(collateralBalancePoolSavingsAfter).toString()} Expected: ${baseLiquidityShares.toString()}`
                );
            });
        });

        describe('Amount lent > minBorrowAmount at the end of collection period', async () => {
            let poolStrategy: IYield;
            beforeEach(async () => {
                let deployHelper: DeployHelper = new DeployHelper(borrower);
                collateralToken = await deployHelper.mock.getMockERC20(
                    Contracts.DAI
                );

                borrowToken = await deployHelper.mock.getMockERC20(
                    Contracts.LINK
                );
                poolStrategy = await deployHelper.mock.getYield(
                    compoundYield.address
                );

                const salt = sha256(
                    Buffer.from('borrower' + Math.random() * 10000000)
                );

                let generatedPoolAddress: Address = await getPoolAddress(
                    borrower.address,
                    Contracts.LINK,
                    Contracts.DAI,
                    poolStrategy.address,
                    poolFactory.address,
                    salt,
                    poolImpl.address,
                    false
                );

                const nonce =
                    (await poolFactory.provider.getTransactionCount(
                        poolFactory.address
                    )) + 1;
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

                await collateralToken
                    .connect(borrower)
                    .approve(generatedPoolAddress, _collateralAmount);

                await expect(
                    poolFactory
                        .connect(borrower)
                        .createPool(
                            _poolSize,
                            _minborrowAmount,
                            Contracts.LINK,
                            Contracts.DAI,
                            _collateralRatio,
                            _borrowRate,
                            _repaymentInterval,
                            _noOfRepaymentIntervals,
                            poolStrategy.address,
                            _collateralAmount,
                            false,
                            salt
                        )
                )
                    .to.emit(poolFactory, 'PoolCreated')
                    .withArgs(
                        generatedPoolAddress,
                        borrower.address,
                        newPoolToken
                    );

                poolToken = await deployHelper.pool.getPoolToken(newPoolToken);

                pool = await deployHelper.pool.getPool(generatedPoolAddress);

                amount = createPoolParams._minborrowAmount.add(10);
                await borrowToken.connect(admin).transfer(
                    lender.address,
                    amount
                );
                await borrowToken.connect(lender).approve(
                    pool.address,
                    amount
                );
                await pool.connect(lender).lend(lender.address, amount, false);

                const { loanStartTime } = await pool.poolConstants();
                await blockTravel(
                    network,
                    parseInt(loanStartTime.add(1).toString())
                );
            });

            it('Lender pool tokens should be transferrable', async () => {
                const balance = await poolToken.balanceOf(lender.address);
                const balanceBefore = await poolToken.balanceOf(
                    lender1.address
                );
                await poolToken
                    .connect(lender)
                    .transfer(lender1.address, balance);
                const balanceAfter = await poolToken.balanceOf(lender1.address);
                assert(
                    balanceBefore.add(balance).toString() ==
                        balanceAfter.toString(),
                    'Pool token transfer not working'
                );
                const balanceSenderAfter = await poolToken.balanceOf(
                    lender.address
                );
                assert(
                    balanceSenderAfter.toString() == '0',
                    `Pool token not getting transferred correctly. Expected: 0, actual: ${balanceSenderAfter.toString()}`
                );
            });

            it('Lender cannot withdraw tokens', async () => {
                await expect(
                    pool.connect(lender).withdrawLiquidity()
                ).to.revertedWith('24');
            });

            it('Borrower can withdraw', async () => {
                const borrowAssetBalanceBorrower = await borrowToken.balanceOf(
                    borrower.address
                );
                const borrowAssetBalancePool = await borrowToken.balanceOf(
                    pool.address
                );
                const borrowAssetBalancePoolSavings =
                    await savingsAccount.userLockedBalance(
                        pool.address,
                        borrowToken.address,
                        zeroAddress
                    );
                const tokensLent = await poolToken.totalSupply();
                await pool.connect(borrower).withdrawBorrowedAmount();
                const borrowAssetBalanceBorrowerAfter =
                    await borrowToken.balanceOf(borrower.address);
                const borrowAssetBalancePoolAfter = await borrowToken.balanceOf(
                    pool.address
                );
                const borrowAssetBalancePoolSavingsAfter =
                    await savingsAccount.userLockedBalance(
                        pool.address,
                        borrowToken.address,
                        zeroAddress
                    );
                const tokensLentAfter = await poolToken.totalSupply();

                assert(
                    tokensLent.toString() == tokensLentAfter.toString(),
                    'Tokens lent changing while withdrawing borrowed amount'
                );
                assert(
                    borrowAssetBalanceBorrower.add(tokensLent).toString() ==
                        borrowAssetBalanceBorrowerAfter.toString(),
                    'Borrower not receiving correct lent amount'
                );
                assert(
                    borrowAssetBalancePool.toString() == borrowAssetBalancePoolAfter.add(tokensLentAfter).toString(), 
                    `Pool token balance is not changing correctly. Expected: ${borrowAssetBalancePoolAfter.toString()} Actual: ${borrowAssetBalancePool.sub(tokensLentAfter).toString()}`
                );
                assert(
                    borrowAssetBalancePoolSavings.toString() == borrowAssetBalancePoolSavingsAfter.toString(), 
                    `Savings account changing instead of token balance`
                );
            });

            it('Borrower can cancel pool with penality before withdrawing', async () => {
                const collateralBalanceBorrowerSavings =
                    await savingsAccount.userLockedBalance(
                        borrower.address,
                        collateralToken.address,
                        poolStrategy.address
                    );
                const collateralBalancePoolSavings =
                    await savingsAccount.userLockedBalance(
                        pool.address,
                        collateralToken.address,
                        poolStrategy.address
                    );
                const { baseLiquidityShares } = await pool.poolVars();
                await expect(
                    pool.connect(lender).cancelPool()
                ).to.revertedWith("CP2");
                const penality = baseLiquidityShares.mul(testPoolFactoryParams._poolCancelPenalityFraction).mul(await poolToken.totalSupply()).div(createPoolParams._poolSize).div(BigNumber.from(10).pow(30));
                await pool.connect(borrower).cancelPool();
                const collateralBalanceBorrowerSavingsAfter = await savingsAccount.userLockedBalance(borrower.address, collateralToken.address, poolStrategy.address);
                const collateralBalancePoolSavingsAfter = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                const collateralAfterPenality = baseLiquidityShares.sub(penality);
                assert(
                    collateralBalanceBorrowerSavingsAfter.sub(collateralBalanceBorrowerSavings).toString() == collateralAfterPenality.sub(1).toString(),
                    `Borrower didn't receive collateral back correctly Actual: ${collateralBalanceBorrowerSavingsAfter.sub(collateralBalanceBorrowerSavings).toString()}, Expected: ${baseLiquidityShares.toString()}`
                );
                assert(
                    collateralBalancePoolSavings.sub(collateralBalancePoolSavingsAfter).toString() == collateralAfterPenality.sub(1).toString(),
                    `Pool shares didn't decrease correctly Actual: ${collateralBalancePoolSavings.sub(collateralBalancePoolSavingsAfter).toString()} Expected: ${baseLiquidityShares.toString()}`
                );
            });

            it('Borrower cannot cancel pool twice', async () => {
                await pool.connect(borrower).cancelPool();
                await expect(
                    pool.connect(borrower).cancelPool()
                ).to.revertedWith('CP1');
            });

            it('Pool tokens are not transferrable after pool cancel', async () => {
                await pool.connect(borrower).cancelPool();
                const balance = await poolToken.balanceOf(lender.address);
                await expect(
                    poolToken.connect(lender).transfer(lender1.address, balance)
                ).to.be.revertedWith("ERC20Pausable: token transfer while paused");
            });

            it("Once pool is cancelled anyone can liquidate penality, direct penality withdrawal", async () => {
                await pool.connect(borrower).cancelPool();
                const collateralTokensRandom = await collateralToken.balanceOf(random.address);
                const collateralSharesPool = (await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address));
                let collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool.sub(2), collateralToken.address);
                let borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                await borrowToken.connect(admin).transfer(random.address, borrowTokensForCollateral);
                await borrowToken.connect(random).approve(pool.address, borrowTokensForCollateral);
                const borrowTokenRandom = await borrowToken.balanceOf(random.address);
                const borrowTokenPool = await borrowToken.balanceOf(pool.address);
                await pool.connect(random).liquidateCancelPenality(false, false);
                collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool.sub(2), collateralToken.address);
                borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);

                const collateralTokensRandomAfter = await collateralToken.balanceOf(random.address);
                const collateralSharesPoolAfter = await (await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address));
                const collateralTokensPoolAfter = await poolStrategy.callStatic.getTokensForShares(collateralSharesPoolAfter.sub(2), collateralToken.address);
                const borrowTokenRandomAfter = await borrowToken.balanceOf(random.address);
                const borrowTokenPoolAfter = await borrowToken.balanceOf(pool.address);
                assert(
                    collateralTokensRandomAfter.sub(collateralTokensRandom).toString() == collateralTokensPool.toString(),
                    `Collateral tokens not correctly received by liquidator Actual: ${collateralTokensRandomAfter.sub(collateralTokensRandom).toString()} Expected: ${collateralTokensPool.toString()}`
                );
                assert(
                    collateralTokensPool.sub(collateralTokensPoolAfter).toString() == collateralTokensPool.toString(),
                    `Collateral tokens not correctly taken from pool Actual: ${collateralTokensPool.sub(collateralTokensPoolAfter).toString()} Expected: ${collateralTokensPool.toString()}`
                );
                collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool.sub(1), collateralToken.address);
                borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                const borrowTokensToDeposit = borrowTokensForCollateral.sub(borrowTokensForCollateral.mul(testPoolFactoryParams._liquidatorRewardFraction).div(BigNumber.from(10).pow(30)));
                assert(
                    borrowTokenRandom.sub(borrowTokenRandomAfter).toString() == borrowTokensToDeposit.sub(1).toString(),
                    `Borrow token not pulled correctly from liquidator Actual: ${borrowTokenRandom.sub(borrowTokenRandomAfter).toString()} Expected: ${borrowTokensToDeposit.toString()}`
                );
                assert(
                    borrowTokenPoolAfter.sub(borrowTokenPool).toString() == borrowTokensToDeposit.sub(1).toString(),
                    `Borrow token not deposited to pool correctly Actual: ${borrowTokenPoolAfter.sub(borrowTokenPool).toString()} Expected: ${borrowTokensToDeposit.toString()}`
                );
            });

            it("Once pool is cancelled anyone can liquidate penality, peanlity direct LP share", async () => {
                await pool.connect(borrower).cancelPool();
                let deployHelper: DeployHelper = new DeployHelper(borrower);
                const yToken: ERC20 = await deployHelper.mock.getMockERC20(await poolStrategy.liquidityToken(collateralToken.address));
                const collateralSharesRandom = await yToken.balanceOf(random.address);
                const collateralSharesPool = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                let collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool, collateralToken.address);
                let borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                await borrowToken.connect(admin).transfer(random.address, borrowTokensForCollateral);
                await borrowToken.connect(random).approve(pool.address, borrowTokensForCollateral);
                const borrowTokenRandom = await borrowToken.balanceOf(random.address);
                const borrowTokenPool = await borrowToken.balanceOf(pool.address);
                
                await pool.connect(random).liquidateCancelPenality(false, true);

                const collateralSharesRandomAfter = await yToken.balanceOf(random.address);
                const collateralSharesPoolAfter = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                const borrowTokenRandomAfter = await borrowToken.balanceOf(random.address);
                const borrowTokenPoolAfter = await borrowToken.balanceOf(pool.address);

                assert(
                    collateralSharesRandomAfter.sub(collateralSharesRandom).toString() == collateralSharesPool.sub(2).toString(),
                    `Collateral shares not correctly received by liquidator. Actual: ${collateralSharesRandomAfter.sub(collateralSharesRandom).toString()} Expected: ${collateralSharesPool.toString()}`
                );
                assert(
                    collateralSharesPool.sub(collateralSharesPoolAfter).toString() == collateralSharesPool.sub(2).toString(),
                    `Collateral tokens not correctly taken from pool`
                );
                collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool.sub(1), collateralToken.address);
                borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                const borrowTokensToDeposit = borrowTokensForCollateral.sub(borrowTokensForCollateral.mul(testPoolFactoryParams._liquidatorRewardFraction).div(BigNumber.from(10).pow(30)));
                assert(
                    borrowTokenRandom.sub(borrowTokenRandomAfter).toString() == borrowTokensToDeposit.toString(),
                    `Borrow token not pulled correctly from liquidator. Actual: ${borrowTokenRandom.sub(borrowTokenRandomAfter).toString()} Expected: ${borrowTokensToDeposit.toString()}`
                );
                assert(
                    borrowTokenPoolAfter.sub(borrowTokenPool).toString() == borrowTokensToDeposit.toString(),
                    `Borrow token not deposited to pool correctly`
                );
            });

            // Note: _receiveLiquidityShares doesn't matter when sending to savings account
            it("Once pool is cancelled anyone can liquidate penality, penality to savings", async () => {
                await pool.connect(borrower).cancelPool();
                const collateralSavingsRandom = await savingsAccount.userLockedBalance(random.address, collateralToken.address, poolStrategy.address);
                const collateralSharesPool = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                let collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool, collateralToken.address);
                let borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                await borrowToken.connect(admin).transfer(random.address, borrowTokensForCollateral);
                await borrowToken.connect(random).approve(pool.address, borrowTokensForCollateral);
                const borrowTokenRandom = await borrowToken.balanceOf(random.address);
                const borrowTokenPool = await borrowToken.balanceOf(pool.address);
                await pool.connect(random).liquidateCancelPenality(true, true);

                const collateralSavingsRandomAfter = await savingsAccount.userLockedBalance(random.address, collateralToken.address, poolStrategy.address);
                const collateralSharesPoolAfter = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                const collateralTokensPoolAfter = await poolStrategy.callStatic.getTokensForShares(collateralSharesPoolAfter, collateralToken.address);
                const borrowTokenRandomAfter = await borrowToken.balanceOf(random.address);
                const borrowTokenPoolAfter = await borrowToken.balanceOf(pool.address);

                assert(
                    collateralSavingsRandomAfter.sub(collateralSavingsRandom).toString() == collateralSharesPool.sub(2).toString(),
                    `Collateral not correctly received by liquidator in savings account. Actual: ${collateralSavingsRandomAfter.sub(collateralSavingsRandom).toString()} Expected: ${collateralSharesPool.toString()}`
                );
                assert(
                    collateralSharesPool.sub(collateralSharesPoolAfter).toString() == collateralSharesPool.sub(2).toString(),
                    `Collateral tokens not correctly taken from pool`
                );
                collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool.sub(1), collateralToken.address);
                borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                const borrowTokensToDeposit = borrowTokensForCollateral.sub(borrowTokensForCollateral.mul(testPoolFactoryParams._liquidatorRewardFraction).div(BigNumber.from(10).pow(30)));
                assert(
                    borrowTokenRandom.sub(borrowTokenRandomAfter).toString() == borrowTokensToDeposit.toString(),
                    `Borrow token not pulled correctly from liquidator`
                );
                assert(
                    borrowTokenPoolAfter.sub(borrowTokenPool).toString() == borrowTokensToDeposit.toString(),
                    `Borrow token not deposited to pool correctly`
                );
            });

            it("Pool cancellation once liquidated cannot be liquidated again", async () => {
                await pool.connect(borrower).cancelPool();
                const collateralSharesPool = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                const collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool, collateralToken.address);
                const borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                await borrowToken.connect(admin).transfer(random.address, borrowTokensForCollateral);
                await borrowToken.connect(random).approve(pool.address, borrowTokensForCollateral);
                await pool.connect(random).liquidateCancelPenality(false, false);
                await expect(
                    pool.connect(random).liquidateCancelPenality(false, false)
                ).to.be.revertedWith("");
            });

            it("Lender who withdraws lent amount before pool cancel penality doesn't get share of cancel penality", async () => {
                await pool.connect(borrower).cancelPool();

                const borrowTokenPool = await borrowToken.balanceOf(pool.address);
                const borrowTokenLender = await borrowToken.balanceOf(lender.address);
                const totalPoolTokens = await poolToken.totalSupply();
                const poolTokenLender = await poolToken.balanceOf(lender.address);
                await pool.connect(lender).withdrawLiquidity();
                const borrowTokenPoolAfter = await borrowToken.balanceOf(pool.address);
                const borrowTokenLenderAfter = await borrowToken.balanceOf(lender.address);
                const totalPoolTokensAfter = await poolToken.totalSupply();
                const poolTokenLenderAfter = await poolToken.balanceOf(lender.address);

                assert(
                    borrowTokenPool.sub(borrowTokenPoolAfter).toString() == amount.toString(),
                    `Borrow tokens not correctly collected from pool. Actual: ${borrowTokenPool.sub(borrowTokenPoolAfter).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    borrowTokenLenderAfter.sub(borrowTokenLender).toString() == amount.toString(),
                    `Borrow tokens not correctly receoved by lender. Actual: ${borrowTokenLenderAfter.sub(borrowTokenLender).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    totalPoolTokens.sub(totalPoolTokensAfter).toString() == amount.toString(),
                    `Total pool tokens not correctly managed. Actual: ${totalPoolTokens.sub(totalPoolTokensAfter).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    poolTokenLender.sub(poolTokenLenderAfter).toString() == amount.toString(),
                    `Pool tokens of lender not correctly burnt. Actual: ${poolTokenLender.sub(poolTokenLenderAfter).toString()} Expected: ${amount.toString()}`
                );
            });

            it("Lender who withdraws lent amount after pool cancel penality gets share of cancel penality", async () => {
                await pool.connect(borrower).cancelPool();
                const collateralSharesPool = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                const collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool, collateralToken.address);
                const borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                await borrowToken.connect(admin).transfer(random.address, borrowTokensForCollateral);
                await borrowToken.connect(random).approve(pool.address, borrowTokensForCollateral);
                await pool.connect(random).liquidateCancelPenality(false, false);

                const { penalityLiquidityAmount } = await pool.poolVars();
                const lenderCancelBonus = penalityLiquidityAmount.mul(
                    (await poolToken.balanceOf(lender.address))).div((await poolToken.totalSupply())
                );

                const borrowTokenPool = await borrowToken.balanceOf(pool.address);
                const borrowTokenLender = await borrowToken.balanceOf(lender.address);
                const totalPoolTokens = await poolToken.totalSupply();
                const poolTokenLender = await poolToken.balanceOf(lender.address);
                await pool.connect(lender).withdrawLiquidity();
                const borrowTokenPoolAfter = await borrowToken.balanceOf(pool.address);
                const borrowTokenLenderAfter = await borrowToken.balanceOf(lender.address);
                const totalPoolTokensAfter = await poolToken.totalSupply();
                const poolTokenLenderAfter = await poolToken.balanceOf(lender.address);

                assert(
                    borrowTokenPool.sub(borrowTokenPoolAfter).toString() == amount.add(lenderCancelBonus).toString(),
                    `Borrow tokens not correctly collected from pool. Actual: ${borrowTokenPool.sub(borrowTokenPoolAfter).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    borrowTokenLenderAfter.sub(borrowTokenLender).toString() == amount.add(lenderCancelBonus).toString(),
                    `Borrow tokens not correctly receoved by lender. Actual: ${borrowTokenLenderAfter.sub(borrowTokenLender).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    totalPoolTokens.sub(totalPoolTokensAfter).toString() == amount.toString(),
                    `Total pool tokens not correctly managed. Actual: ${totalPoolTokens.sub(totalPoolTokensAfter).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    poolTokenLender.sub(poolTokenLenderAfter).toString() == amount.toString(),
                    `Pool tokens of lender not correctly burnt. Actual: ${poolTokenLender.sub(poolTokenLenderAfter).toString()} Expected: ${amount.toString()}`
                );
            });

            it("Non withdrawal Cancel - anyone can cancel pool and penalize borrower", async () => {
                const { loanWithdrawalDeadline } = await pool.poolConstants();
                assert(loanWithdrawalDeadline.toString() != "0", `Loan withdrawal deadline not set`);
                await blockTravel(network, parseInt(loanWithdrawalDeadline.add(1).toString()));

                const collateralBalanceRandomSavings = await savingsAccount.userLockedBalance(random.address, collateralToken.address, poolStrategy.address);
                const collateralBalanceRandom = await collateralToken.balanceOf(random.address);
                const collateralBalanceBorrowerSavings = await savingsAccount.userLockedBalance(borrower.address, collateralToken.address, poolStrategy.address);
                const collateralBalancePoolSavings = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                const { baseLiquidityShares } = await pool.poolVars();
                const penality = baseLiquidityShares.mul(testPoolFactoryParams._poolCancelPenalityFraction).mul(await poolToken.totalSupply()).div(createPoolParams._poolSize).div(BigNumber.from(10).pow(30));
                await pool.connect(random).cancelPool();
                const collateralBalanceBorrowerSavingsAfter = await savingsAccount.userLockedBalance(borrower.address, collateralToken.address, poolStrategy.address);
                const collateralBalancePoolSavingsAfter = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                const collateralBalanceRandomSavingsAfter = await savingsAccount.userLockedBalance(random.address, collateralToken.address, poolStrategy.address);
                const collateralBalanceRandomAfter = await collateralToken.balanceOf(random.address);
                const collateralAfterPenality = baseLiquidityShares.sub(penality);
                assert(
                    collateralBalanceBorrowerSavingsAfter.sub(collateralBalanceBorrowerSavings).toString() == collateralAfterPenality.sub(1).toString(),
                    `Borrower didn't receive collateral back correctly Actual: ${collateralBalanceBorrowerSavingsAfter.sub(collateralBalanceBorrowerSavings).toString()}, Expected: ${baseLiquidityShares.toString()}`
                );
                assert(
                    collateralBalancePoolSavings.sub(collateralBalancePoolSavingsAfter).toString() == collateralAfterPenality.sub(1).toString(),
                    `Pool shares didn't decrease correctly Actual: ${collateralBalancePoolSavings.sub(collateralBalancePoolSavingsAfter).toString()} Expected: ${baseLiquidityShares.toString()}`
                );
                assert(
                    collateralBalanceRandomSavings.toString() == collateralBalanceRandomSavingsAfter.toString(),
                    "User who cancels shouldn't get collateral shares"
                );
                assert(
                    collateralBalanceRandom.toString() == collateralBalanceRandomAfter.toString(),
                    "User who cancels shouldn't get collateral tokens"
                );
            });

            it("Non withdrawal Cancel - Anyone can liquidate penality", async () => {
                const { loanWithdrawalDeadline } = await pool.poolConstants();
                assert(loanWithdrawalDeadline.toString() != "0", `Loan withdrawal deadline not set`);
                await blockTravel(network, parseInt(loanWithdrawalDeadline.add(1).toString()));

                await pool.connect(random).cancelPool();
                const collateralTokensRandom = await collateralToken.balanceOf(random.address);
                const collateralSharesPool = (await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address));
                let collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool.sub(2), collateralToken.address);
                let borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                await borrowToken.connect(admin).transfer(random.address, borrowTokensForCollateral);
                await borrowToken.connect(random).approve(pool.address, borrowTokensForCollateral);
                const borrowTokenRandom = await borrowToken.balanceOf(random.address);
                const borrowTokenPool = await borrowToken.balanceOf(pool.address);
                await pool.connect(random).liquidateCancelPenality(false, false);
                collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool.sub(2), collateralToken.address);
                borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);

                const collateralTokensRandomAfter = await collateralToken.balanceOf(random.address);
                const collateralSharesPoolAfter = await (await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address));
                const collateralTokensPoolAfter = await poolStrategy.callStatic.getTokensForShares(collateralSharesPoolAfter.sub(2), collateralToken.address);
                const borrowTokenRandomAfter = await borrowToken.balanceOf(random.address);
                const borrowTokenPoolAfter = await borrowToken.balanceOf(pool.address);
                assert(
                    collateralTokensRandomAfter.sub(collateralTokensRandom).toString() == collateralTokensPool.toString(),
                    `Collateral tokens not correctly received by liquidator Actual: ${collateralTokensRandomAfter.sub(collateralTokensRandom).toString()} Expected: ${collateralTokensPool.toString()}`
                );
                assert(
                    collateralTokensPool.sub(collateralTokensPoolAfter).toString() == collateralTokensPool.toString(),
                    `Collateral tokens not correctly taken from pool Actual: ${collateralTokensPool.sub(collateralTokensPoolAfter).toString()} Expected: ${collateralTokensPool.toString()}`
                );
                collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool.sub(1), collateralToken.address);
                borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                const borrowTokensToDeposit = borrowTokensForCollateral.sub(borrowTokensForCollateral.mul(testPoolFactoryParams._liquidatorRewardFraction).div(BigNumber.from(10).pow(30)));
                assert(
                    borrowTokenRandom.sub(borrowTokenRandomAfter).toString() == borrowTokensToDeposit.sub(1).toString(),
                    `Borrow token not pulled correctly from liquidator Actual: ${borrowTokenRandom.sub(borrowTokenRandomAfter).toString()} Expected: ${borrowTokensToDeposit.toString()}`
                );
                assert(
                    borrowTokenPoolAfter.sub(borrowTokenPool).toString() == borrowTokensToDeposit.sub(1).toString(),
                    `Borrow token not deposited to pool correctly Actual: ${borrowTokenPoolAfter.sub(borrowTokenPool).toString()} Expected: ${borrowTokensToDeposit.toString()}`
                );
            });

            it("Non withdrawal Cancel - Before penality Liquidation, no rewards for lender", async () => {
                const { loanWithdrawalDeadline } = await pool.poolConstants();
                assert(loanWithdrawalDeadline.toString() != "0", `Loan withdrawal deadline not set`);
                await blockTravel(network, parseInt(loanWithdrawalDeadline.add(1).toString()));

                await pool.connect(random).cancelPool();

                const borrowTokenPool = await borrowToken.balanceOf(pool.address);
                const borrowTokenLender = await borrowToken.balanceOf(lender.address);
                const totalPoolTokens = await poolToken.totalSupply();
                const poolTokenLender = await poolToken.balanceOf(lender.address);
                await pool.connect(lender).withdrawLiquidity();
                const borrowTokenPoolAfter = await borrowToken.balanceOf(pool.address);
                const borrowTokenLenderAfter = await borrowToken.balanceOf(lender.address);
                const totalPoolTokensAfter = await poolToken.totalSupply();
                const poolTokenLenderAfter = await poolToken.balanceOf(lender.address);

                assert(
                    borrowTokenPool.sub(borrowTokenPoolAfter).toString() == amount.toString(),
                    `Borrow tokens not correctly collected from pool. Actual: ${borrowTokenPool.sub(borrowTokenPoolAfter).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    borrowTokenLenderAfter.sub(borrowTokenLender).toString() == amount.toString(),
                    `Borrow tokens not correctly receoved by lender. Actual: ${borrowTokenLenderAfter.sub(borrowTokenLender).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    totalPoolTokens.sub(totalPoolTokensAfter).toString() == amount.toString(),
                    `Total pool tokens not correctly managed. Actual: ${totalPoolTokens.sub(totalPoolTokensAfter).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    poolTokenLender.sub(poolTokenLenderAfter).toString() == amount.toString(),
                    `Pool tokens of lender not correctly burnt. Actual: ${poolTokenLender.sub(poolTokenLenderAfter).toString()} Expected: ${amount.toString()}`
                );
            });

            it("Non withdrawal Cancel - After penality Liquidation, rewards for lender", async () => {
                const { loanWithdrawalDeadline } = await pool.poolConstants();
                assert(loanWithdrawalDeadline.toString() != "0", `Loan withdrawal deadline not set`);
                await blockTravel(network, parseInt(loanWithdrawalDeadline.add(1).toString()));

                await pool.connect(random).cancelPool();

                const collateralSharesPool = await savingsAccount.userLockedBalance(pool.address, collateralToken.address, poolStrategy.address);
                const collateralTokensPool = await poolStrategy.callStatic.getTokensForShares(collateralSharesPool, collateralToken.address);
                const borrowTokensForCollateral = await pool.getEquivalentTokens(collateralToken.address, borrowToken.address, collateralTokensPool);
                await borrowToken.connect(admin).transfer(random.address, borrowTokensForCollateral);
                await borrowToken.connect(random).approve(pool.address, borrowTokensForCollateral);
                await pool.connect(random).liquidateCancelPenality(false, false);

                const { penalityLiquidityAmount } = await pool.poolVars();
                const lenderCancelBonus = penalityLiquidityAmount.mul(
                    (await poolToken.balanceOf(lender.address))).div((await poolToken.totalSupply())
                );

                const borrowTokenPool = await borrowToken.balanceOf(pool.address);
                const borrowTokenLender = await borrowToken.balanceOf(lender.address);
                const totalPoolTokens = await poolToken.totalSupply();
                const poolTokenLender = await poolToken.balanceOf(lender.address);
                await pool.connect(lender).withdrawLiquidity();
                const borrowTokenPoolAfter = await borrowToken.balanceOf(pool.address);
                const borrowTokenLenderAfter = await borrowToken.balanceOf(lender.address);
                const totalPoolTokensAfter = await poolToken.totalSupply();
                const poolTokenLenderAfter = await poolToken.balanceOf(lender.address);

                assert(
                    borrowTokenPool.sub(borrowTokenPoolAfter).toString() == amount.add(lenderCancelBonus).toString(),
                    `Borrow tokens not correctly collected from pool. Actual: ${borrowTokenPool.sub(borrowTokenPoolAfter).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    borrowTokenLenderAfter.sub(borrowTokenLender).toString() == amount.add(lenderCancelBonus).toString(),
                    `Borrow tokens not correctly receoved by lender. Actual: ${borrowTokenLenderAfter.sub(borrowTokenLender).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    totalPoolTokens.sub(totalPoolTokensAfter).toString() == amount.toString(),
                    `Total pool tokens not correctly managed. Actual: ${totalPoolTokens.sub(totalPoolTokensAfter).toString()} Expected: ${amount.toString()}`
                );
                assert(
                    poolTokenLender.sub(poolTokenLenderAfter).toString() == amount.toString(),
                    `Pool tokens of lender not correctly burnt. Actual: ${poolTokenLender.sub(poolTokenLenderAfter).toString()} Expected: ${amount.toString()}`
                );
            });
        })

        describe('Amount lent == minBorrowAmount at the end of collection period', async () => {
            let poolStrategy: IYield;
            beforeEach(async () => {
                let deployHelper: DeployHelper = new DeployHelper(borrower);
                collateralToken = await deployHelper.mock.getMockERC20(
                    Contracts.DAI
                );

                borrowToken = await deployHelper.mock.getMockERC20(
                    Contracts.LINK
                );
                poolStrategy = await deployHelper.mock.getYield(
                    compoundYield.address
                );

                const salt = sha256(
                    Buffer.from('borrower' + Math.random() * 10000000)
                );

                let generatedPoolAddress: Address = await getPoolAddress(
                    borrower.address,
                    Contracts.LINK,
                    Contracts.DAI,
                    poolStrategy.address,
                    poolFactory.address,
                    salt,
                    poolImpl.address,
                    false
                );

                const nonce =
                    (await poolFactory.provider.getTransactionCount(
                        poolFactory.address
                    )) + 1;
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

                await collateralToken
                    .connect(borrower)
                    .approve(generatedPoolAddress, _collateralAmount);

                await expect(
                    poolFactory
                        .connect(borrower)
                        .createPool(
                            _poolSize,
                            _minborrowAmount,
                            Contracts.LINK,
                            Contracts.DAI,
                            _collateralRatio,
                            _borrowRate,
                            _repaymentInterval,
                            _noOfRepaymentIntervals,
                            poolStrategy.address,
                            _collateralAmount,
                            false,
                            salt
                        )
                )
                    .to.emit(poolFactory, 'PoolCreated')
                    .withArgs(
                        generatedPoolAddress,
                        borrower.address,
                        newPoolToken
                    );

                poolToken = await deployHelper.pool.getPoolToken(newPoolToken);

                pool = await deployHelper.pool.getPool(generatedPoolAddress);

                const amount = createPoolParams._minborrowAmount;
                await borrowToken
                    .connect(admin)
                    .transfer(lender.address, amount);
                await borrowToken.connect(lender).approve(pool.address, amount);
                await pool.connect(lender).lend(lender.address, amount, false);

                const { loanStartTime } = await pool.poolConstants();
                await blockTravel(
                    network,
                    parseInt(loanStartTime.add(1).toString())
                );
            });

            it('Lender pool tokens should be transferrable', async () => {
                const balance = await poolToken.balanceOf(lender.address);
                const balanceBefore = await poolToken.balanceOf(
                    lender1.address
                );
                await poolToken
                    .connect(lender)
                    .transfer(lender1.address, balance);
                const balanceAfter = await poolToken.balanceOf(lender1.address);
                assert(
                    balanceBefore.add(balance).toString() ==
                        balanceAfter.toString(),
                    'Pool token transfer not working'
                );
                const balanceSenderAfter = await poolToken.balanceOf(
                    lender.address
                );
                assert(
                    balanceSenderAfter.toString() == '0',
                    `Pool token not getting transferred correctly. Expected: 0, actual: ${balanceSenderAfter.toString()}`
                );
            });

            it('Lender cannot withdraw tokens', async () => {
                await expect(
                    pool.connect(lender).withdrawLiquidity()
                ).to.revertedWith('24');
            });

            it('Borrower can withdraw', async () => {
                const borrowAssetBalanceBorrower = await borrowToken.balanceOf(
                    borrower.address
                );
                const borrowAssetBalancePool = await borrowToken.balanceOf(
                    pool.address
                );
                const borrowAssetBalancePoolSavings =
                    await savingsAccount.userLockedBalance(
                        pool.address,
                        borrowToken.address,
                        zeroAddress
                    );
                const tokensLent = await poolToken.totalSupply();
                await pool.connect(borrower).withdrawBorrowedAmount();
                const borrowAssetBalanceBorrowerAfter =
                    await borrowToken.balanceOf(borrower.address);
                const borrowAssetBalancePoolAfter = await borrowToken.balanceOf(
                    pool.address
                );
                const borrowAssetBalancePoolSavingsAfter =
                    await savingsAccount.userLockedBalance(
                        pool.address,
                        borrowToken.address,
                        zeroAddress
                    );
                const tokensLentAfter = await poolToken.totalSupply();

                assert(
                    tokensLent.toString() == tokensLentAfter.toString(),
                    'Tokens lent changing while withdrawing borrowed amount'
                );
                assert(
                    tokensLent.toString() ==
                        createPoolParams._minborrowAmount.toString(),
                    'TokensLent is not same as minBorrowAmount'
                );
                assert(
                    borrowAssetBalanceBorrower.add(tokensLent).toString() ==
                        borrowAssetBalanceBorrowerAfter.toString(),
                    'Borrower not receiving correct lent amount'
                );
                assert(
                    borrowAssetBalancePool.toString() ==
                        borrowAssetBalancePoolAfter.add(tokensLentAfter).toString(),
                    'Pool token balance is not changing correctly'
                );
                assert(
                    borrowAssetBalancePoolSavings.toString() ==
                        borrowAssetBalancePoolSavingsAfter
                            .toString(),
                    'Savings account balance of pool changing instead of token balance'
                );
                assert(tokensLent.toString() == createPoolParams._minborrowAmount.toString(), "TokensLent is not same as minBorrowAmount");
                assert(borrowAssetBalanceBorrower.add(tokensLent).toString() == borrowAssetBalanceBorrowerAfter.toString(), "Borrower not receiving correct lent amount");
                assert(borrowAssetBalancePool.toString() == borrowAssetBalancePoolAfter.add(tokensLentAfter).toString(), "Pool token balance is changing instead of savings account balance");
                assert(borrowAssetBalancePoolSavings.toString() == borrowAssetBalancePoolSavingsAfter.toString(), "Savings account balance of pool not changing correctly");
            });
        });

        describe('Amount lent == amountRequested at the end of collection period', async () => {
            let poolStrategy: IYield;
            beforeEach(async () => {
                let deployHelper: DeployHelper = new DeployHelper(borrower);
                collateralToken = await deployHelper.mock.getMockERC20(
                    Contracts.DAI
                );

                borrowToken = await deployHelper.mock.getMockERC20(
                    Contracts.LINK
                );
                poolStrategy = await deployHelper.mock.getYield(
                    compoundYield.address
                );

                const salt = sha256(
                    Buffer.from('borrower' + Math.random() * 10000000)
                );

                let generatedPoolAddress: Address = await getPoolAddress(
                    borrower.address,
                    Contracts.LINK,
                    Contracts.DAI,
                    poolStrategy.address,
                    poolFactory.address,
                    salt,
                    poolImpl.address,
                    false
                );

                const nonce =
                    (await poolFactory.provider.getTransactionCount(
                        poolFactory.address
                    )) + 1;
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

                await collateralToken
                    .connect(borrower)
                    .approve(generatedPoolAddress, _collateralAmount);

                await expect(
                    poolFactory
                        .connect(borrower)
                        .createPool(
                            _poolSize,
                            _minborrowAmount,
                            Contracts.LINK,
                            Contracts.DAI,
                            _collateralRatio,
                            _borrowRate,
                            _repaymentInterval,
                            _noOfRepaymentIntervals,
                            poolStrategy.address,
                            _collateralAmount,
                            false,
                            salt
                        )
                )
                    .to.emit(poolFactory, 'PoolCreated')
                    .withArgs(
                        generatedPoolAddress,
                        borrower.address,
                        newPoolToken
                    );

                poolToken = await deployHelper.pool.getPoolToken(newPoolToken);

                pool = await deployHelper.pool.getPool(generatedPoolAddress);

                const amount = createPoolParams._borrowAmountRequested;
                await borrowToken
                    .connect(admin)
                    .transfer(lender.address, amount);
                await borrowToken.connect(lender).approve(pool.address, amount);
                await pool.connect(lender).lend(lender.address, amount, false);

                const { loanStartTime } = await pool.poolConstants();
                await blockTravel(
                    network,
                    parseInt(loanStartTime.add(1).toString())
                );
            });

            it('Lender pool tokens should be transferrable', async () => {
                const balance = await poolToken.balanceOf(lender.address);
                const balanceBefore = await poolToken.balanceOf(
                    lender1.address
                );
                await poolToken
                    .connect(lender)
                    .transfer(lender1.address, balance);
                const balanceAfter = await poolToken.balanceOf(lender1.address);
                assert(
                    balanceBefore.add(balance).toString() ==
                        balanceAfter.toString(),
                    'Pool token transfer not working'
                );
                const balanceSenderAfter = await poolToken.balanceOf(
                    lender.address
                );
                assert(
                    balanceSenderAfter.toString() == '0',
                    `Pool token not getting transferred correctly. Expected: 0, actual: ${balanceSenderAfter.toString()}`
                );
            });

            it('Lender cannot withdraw tokens', async () => {
                await expect(
                    pool.connect(lender).withdrawLiquidity()
                ).to.revertedWith('24');
            });

            it('Borrower can withdraw', async () => {
                const borrowAssetBalanceBorrower = await borrowToken.balanceOf(
                    borrower.address
                );
                const borrowAssetBalancePool = await borrowToken.balanceOf(
                    pool.address
                );
                const borrowAssetBalancePoolSavings =
                    await savingsAccount.userLockedBalance(
                        pool.address,
                        borrowToken.address,
                        zeroAddress
                    );
                const tokensLent = await poolToken.totalSupply();
                await pool.connect(borrower).withdrawBorrowedAmount();
                const borrowAssetBalanceBorrowerAfter =
                    await borrowToken.balanceOf(borrower.address);
                const borrowAssetBalancePoolAfter = await borrowToken.balanceOf(
                    pool.address
                );
                const borrowAssetBalancePoolSavingsAfter =
                    await savingsAccount.userLockedBalance(
                        pool.address,
                        borrowToken.address,
                        zeroAddress
                    );
                const tokensLentAfter = await poolToken.totalSupply();

                assert(
                    tokensLent.toString() == tokensLentAfter.toString(),
                    'Tokens lent changing while withdrawing borrowed amount'
                );
                assert(
                    borrowAssetBalanceBorrower.add(tokensLent).toString() ==
                        borrowAssetBalanceBorrowerAfter.toString(),
                    'Borrower not receiving correct lent amount'
                );
                assert(
                    borrowAssetBalancePool.toString() ==
                        borrowAssetBalancePoolAfter.add(tokensLentAfter).toString(),
                    'Pool token balance not changing correctly'
                );
                assert(
                    borrowAssetBalancePoolSavings.toString() ==
                        borrowAssetBalancePoolSavingsAfter
                            .toString(),
                    'Savings account balance of pool is changing instead of token balance'
                );
                assert(borrowAssetBalanceBorrower.add(tokensLent).toString() == borrowAssetBalanceBorrowerAfter.toString(), "Borrower not receiving correct lent amount");
                assert(borrowAssetBalancePool.toString() == borrowAssetBalancePoolAfter.add(tokensLentAfter).toString(), "Pool token balance is changing instead of savings account balance");
                assert(borrowAssetBalancePoolSavings.toString() == borrowAssetBalancePoolSavingsAfter.toString(), "Savings account balance of pool not changing correctly");
            });
        });
    });
});
