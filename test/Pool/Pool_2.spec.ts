import { ethers, network } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { expect } from 'chai';

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
    extensionParams,
} from '../../utils/constants';
import DeployHelper from '../../utils/deploys';

import { SavingsAccount } from '../../typechain/SavingsAccount';
import { StrategyRegistry } from '../../typechain/StrategyRegistry';
import { getPoolAddress, getRandomFromArray, incrementChain } from '../../utils/helpers';
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

describe('Pool', async () => {
    let savingsAccount: SavingsAccount;
    let strategyRegistry: StrategyRegistry;

    let mockCreditLines: SignerWithAddress;
    let proxyAdmin: SignerWithAddress;
    let admin: SignerWithAddress;
    let borrower: SignerWithAddress;
    let lender: SignerWithAddress;

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
        [proxyAdmin, admin, mockCreditLines, borrower, lender] = await ethers.getSigners();
        const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
        savingsAccount = await deployHelper.core.deploySavingsAccount();
        strategyRegistry = await deployHelper.core.deployStrategyRegistry();

        //initialize
        savingsAccount.initialize(admin.address, strategyRegistry.address, mockCreditLines.address);
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
        await BatTokenContract.connect(Binance7).transfer(admin.address, BigNumber.from('10').pow(23)); // 10,000 BAT tokens

        LinkTokenContract = await deployHelper.mock.getMockERC20(Contracts.LINK);
        await LinkTokenContract.connect(Binance7).transfer(admin.address, BigNumber.from('10').pow(23)); // 10,000 LINK tokens

        DaiTokenContract = await deployHelper.mock.getMockERC20(Contracts.DAI);
        await DaiTokenContract.connect(WhaleAccount).transfer(admin.address, BigNumber.from('10').pow(23)); // 10,000 DAI

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
        await yearnYield.connect(admin).updateProtocolAddresses(DaiTokenContract.address, DAI_Yearn_Protocol_Address);

        compoundYield = await deployHelper.core.deployCompoundYield();
        await compoundYield.initialize(admin.address, savingsAccount.address);
        await strategyRegistry.connect(admin).addStrategy(compoundYield.address);
        await compoundYield.connect(admin).updateProtocolAddresses(Contracts.DAI, Contracts.cDAI);

        verification = await deployHelper.helper.deployVerification();
        await verification.connect(admin).initialize(admin.address);
        await verification.connect(admin).registerUser(borrower.address, sha256(Buffer.from('Borrower')));

        priceOracle = await deployHelper.helper.deployPriceOracle();
        await priceOracle.connect(admin).initialize(admin.address);
        await priceOracle.connect(admin).setfeedAddress(Contracts.LINK, ChainLinkAggregators['LINK/USD']);
        await priceOracle.connect(admin).setfeedAddress(Contracts.DAI, ChainLinkAggregators['DAI/USD']);
    });

    describe('Use Pool', async () => {
        let extenstion: Extension;
        let poolImpl: Pool;
        let poolTokenImpl: PoolToken;
        let poolFactory: PoolFactory;
        let repaymentImpl: Repayments;

        before(async () => {
            const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
            poolFactory = await deployHelper.pool.deployPoolFactory();
            extenstion = await deployHelper.pool.deployExtenstion();
            await extenstion.connect(admin).initialize(poolFactory.address, extensionParams.votingPassRatio);
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
                    admin.address,
                    _collectionPeriod,
                    _matchCollateralRatioInterval,
                    _marginCallDuration,
                    _collateralVolatilityThreshold,
                    _gracePeriodPenaltyFraction,
                    _poolInitFuncSelector,
                    _poolTokenInitFuncSelector,
                    _liquidatorRewardFraction,
                    _poolCancelPenalityFraction
                );
            poolImpl = await deployHelper.pool.deployPool();
            poolTokenImpl = await deployHelper.pool.deployPoolToken();
            repaymentImpl = await deployHelper.pool.deployRepayments();
        });

        describe('Lend', async () => {
            let pool: Pool;
            before(async () => {
                await poolFactory.connect(admin).updateSupportedBorrowTokens(Contracts.DAI, true);

                await poolFactory.connect(admin).updateSupportedCollateralTokens(Contracts.LINK, true);

                await poolFactory.connect(admin).setImplementations(
                    poolImpl.address, 
                    repaymentImpl.address, 
                    poolTokenImpl.address,
                    verification.address,
                    strategyRegistry.address,
                    priceOracle.address,
                    savingsAccount.address,
                    extenstion.address
                );

                let deployHelper: DeployHelper = new DeployHelper(borrower);
                let collateralToken: ERC20 = await deployHelper.mock.getMockERC20(Contracts.LINK);

                let generatedPoolAddress: Address = await getPoolAddress(
                    borrower.address,
                    Contracts.DAI,
                    Contracts.LINK,
                    aaveYield.address,
                    poolFactory.address,
                    sha256(Buffer.from('borrower')),
                    poolImpl.address,
                    false
                );

                const nonce = (await poolFactory.provider.getTransactionCount(poolFactory.address)) + 1;
                let newPoolToken: string = getContractAddress({
                    from: poolFactory.address,
                    nonce,
                });

                // console.log({
                //   generatedPoolAddress,
                //   msgSender: borrower.address,
                //   newPoolToken,
                //   savingsAccountFromPoolFactory: await poolFactory.savingsAccount(),
                //   savingsAccount: savingsAccount.address
                // });

                let {
                    _poolSize,
                    _minborrowAmount,
                    _collateralRatio,
                    _borrowRate,
                    _repaymentInterval,
                    _noOfRepaymentIntervals,
                    _collateralAmount,
                } = createPoolParams;

                await collateralToken.connect(admin).transfer(borrower.address, _collateralAmount.mul(2)); // Transfer quantity to borrower

                await collateralToken.approve(generatedPoolAddress, _collateralAmount.mul(2));

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
                            sha256(Buffer.from('borrower'))
                        )
                )
                    .to.emit(poolFactory, 'PoolCreated')
                    .withArgs(generatedPoolAddress, borrower.address, newPoolToken);

                let newlyCreatedToken: PoolToken = await deployHelper.pool.getPoolToken(newPoolToken);

                expect(await newlyCreatedToken.name()).eq('Open Borrow Pool Tokens');
                expect(await newlyCreatedToken.symbol()).eq('OBPT');
                expect(await newlyCreatedToken.decimals()).eq(18);

                pool = await deployHelper.pool.getPool(generatedPoolAddress);
                await pool.connect(borrower).depositCollateral(_collateralAmount, false);
            });

            it('Test Lending', async () => {
                const deployHelper: DeployHelper = new DeployHelper(admin);
                const DaiTokenContract = await deployHelper.mock.getMockERC20(Contracts.DAI);
                await DaiTokenContract.transfer(lender.address, OperationalAmounts._amountLent);
                await DaiTokenContract.connect(lender).approve(pool.address, OperationalAmounts._amountLent);

                await expect(pool.connect(lender).lend(lender.address, OperationalAmounts._amountLent, false))
                    .to.emit(pool, 'LiquiditySupplied')
                    .withArgs(OperationalAmounts._amountLent, lender.address);
            });

            it('Lender should not be able to withdraw the tokens lent (collection stage)', async () => {
                //   console.log(await pool.connect(lender).poolVars());
                await expect(pool.connect(lender).withdrawLiquidity()).to.be.revertedWith('24');
            });
        });
    });
});

function print(data: any) {
    console.log(JSON.stringify(data, null, 4));
}
