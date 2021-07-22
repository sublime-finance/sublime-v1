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
    LINK_Yearn_Protocol_Address,
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
import { CreditLine } from '../../typechain/CreditLine';

import { Contracts } from '../../existingContracts/compound.json';
import { sha256 } from '@ethersproject/sha2';
import { PoolToken } from '../../typechain/PoolToken';
import { Repayments } from '../../typechain/Repayments';
import { ContractTransaction } from '@ethersproject/contracts';
import { getContractAddress } from '@ethersproject/address';
import { BytesLike } from '@ethersproject/bytes';

describe('Credit Lines', async () => {
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

        await strategyRegistry.connect(admin).addStrategy(zeroAddress);

        await strategyRegistry.connect(admin).addStrategy(aaveYield.address);

        yearnYield = await deployHelper.core.deployYearnYield();
        await yearnYield.initialize(admin.address, savingsAccount.address);
        await strategyRegistry.connect(admin).addStrategy(yearnYield.address);
        await yearnYield.connect(admin).updateProtocolAddresses(DaiTokenContract.address, DAI_Yearn_Protocol_Address);

        await yearnYield.connect(admin).updateProtocolAddresses(LinkTokenContract.address, LINK_Yearn_Protocol_Address);

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

    describe('Create Credit Lines Contract Amount Checks', async () => {
        let creditLine: CreditLine;
        let poolFactory: PoolFactory;
        let extenstion: Extension;

        let borrowerCreditLine: BytesLike;
        let lenderCreditLine: BytesLike;

        let borrowLimit: BigNumber = BigNumber.from('10').mul('1000000000000000000');

        let collateralAmountToUse = BigNumber.from('25').mul('1000000000000000000');
        let largeAmount = BigNumber.from('10').mul('1000000000000000000');
        let amountToBorrow = BigNumber.from('1').mul('1000000000000000000');

        before(async () => {
            const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
            creditLine = await deployHelper.core.deployCreditLines();
            poolFactory = await deployHelper.pool.deployPoolFactory();
            extenstion = await deployHelper.pool.deployExtenstion();

            await extenstion.connect(admin).initialize(poolFactory.address, extensionParams.votingPassRatio);
            await savingsAccount.connect(admin).updateCreditLine(creditLine.address);

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
            const poolImpl = await deployHelper.pool.deployPool();
            const poolTokenImpl = await deployHelper.pool.deployPoolToken();
            const repaymentImpl = await deployHelper.pool.deployRepayments();
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

            await creditLine.connect(admin).initialize(
                yearnYield.address, 
                poolFactory.address, 
                strategyRegistry.address,
                admin.address
            );
        });

        it('Request Credit Line to borrower', async () => {
            let _borrower: string = borrower.address;
            let _liquidationThreshold: BigNumberish = BigNumber.from(100);
            let _borrowRate: BigNumberish = BigNumber.from(1).mul(BigNumber.from('10').pow(28));
            let _autoLiquidation: boolean = true;
            let _collateralRatio: BigNumberish = BigNumber.from(250);
            let _borrowAsset: string = Contracts.DAI;
            let _collateralAsset: string = Contracts.LINK;

            let values = await creditLine
                .connect(lender)
                .callStatic.requestCreditLineToBorrower(
                    _borrower,
                    borrowLimit,
                    _liquidationThreshold,
                    _borrowRate,
                    _autoLiquidation,
                    _collateralRatio,
                    _borrowAsset,
                    _collateralAsset
                );

            await expect(
                creditLine
                    .connect(lender)
                    .requestCreditLineToBorrower(
                        _borrower,
                        borrowLimit,
                        _liquidationThreshold,
                        _borrowRate,
                        _autoLiquidation,
                        _collateralRatio,
                        _borrowAsset,
                        _collateralAsset
                    )
            )
                .to.emit(creditLine, 'CreditLineRequestedToBorrower')
                .withArgs(values, lender.address, borrower.address);

            borrowerCreditLine = values;
            let creditLineInfo = await creditLine.creditLineInfo(values);
            // console.log({ creditLineInfo });
        });

        it('Accept Credit Line (Borrower)', async () => {
            await expect(creditLine.connect(borrower).acceptCreditLineBorrower(borrowerCreditLine))
                .to.emit(creditLine, 'CreditLineAccepted')
                .withArgs(borrowerCreditLine);
        });

        it('Deposit Collateral into existing credit line (not from savings account)', async () => {
            // console.log({ borrowerCreditLine, lenderCreditLine });
            // console.log(await creditLine.creditLineInfo(borrowerCreditLine));
            let valueToTest: BigNumberish = collateralAmountToUse;

            await LinkTokenContract.connect(admin).transfer(borrower.address, valueToTest);
            await LinkTokenContract.connect(borrower).approve(creditLine.address, valueToTest); // yearn yield is the default strategy in this case

            await creditLine.connect(borrower).depositCollateral(Contracts.LINK, valueToTest, borrowerCreditLine, false);
        });

        it('Calculate Interest', async () => {
            expect(
                await creditLine.calculateInterest(
                    BigNumber.from('1000').mul('1000000000000000000000'),
                    BigNumber.from('1'),
                    BigNumber.from('1000000000000000')
                )
            ).to.gt(0);
        });

        it('Borrow From Credit Line', async () => {
            await DaiTokenContract.connect(admin).transfer(lender.address, largeAmount.mul(100));

            await DaiTokenContract.connect(lender).approve(savingsAccount.address, largeAmount.mul(100));

            await savingsAccount.connect(lender).depositTo(largeAmount.mul(100), DaiTokenContract.address, zeroAddress, lender.address);

            await savingsAccount.connect(lender).approve(DaiTokenContract.address, creditLine.address, amountToBorrow);

            await creditLine.connect(borrower).borrowFromCreditLine(amountToBorrow, borrowerCreditLine);
        });

        it('Check Collateralization Ratio', async () => {
            console.log(await creditLine.connect(borrower).callStatic.calculateCurrentCollateralRatio(borrowerCreditLine));
        });

        it('Check Total Collateral Amount', async () => {
            expect(await creditLine.connect(borrower).callStatic.calculateTotalCollateralTokens(borrowerCreditLine)).to.gt(0);
        });

        describe('Failed Cases', async () => {
            it('Cannot borrow more if amount more than borrow limit', async () => {
                await savingsAccount.connect(lender).approve(DaiTokenContract.address, creditLine.address, amountToBorrow);

                await expect(
                    creditLine.connect(borrower).borrowFromCreditLine(amountToBorrow.mul(100), borrowerCreditLine)
                ).to.be.revertedWith('CreditLine: Amount exceeds borrow limit.');
            });
        });

        it('Cannot liquidate if overcollateralized', async () => {
            await DaiTokenContract.connect(admin).approve(creditLine.address, largeAmount.mul(100));
            await expect(creditLine.connect(admin).liquidation(borrowerCreditLine)).to.be.revertedWith(
                'CreditLine: Collateral ratio is higher than liquidation threshold'
            );
        });

        describe('Liquidation', async () => {
            before(async () => {
                // borrow to max limit
                let _borrowableAmount = await creditLine.callStatic.calculateBorrowableAmount(borrowerCreditLine);
                console.log({
                    _borrowableAmountInBefore: _borrowableAmount.toString(),
                });

                await savingsAccount.connect(lender).approve(DaiTokenContract.address, creditLine.address, _borrowableAmount.mul(5).div(4));

                await creditLine.connect(borrower).borrowFromCreditLine(_borrowableAmount.mul(995).div(1000), borrowerCreditLine);

                // increase blocks/time
            });

            it('Liquidate credit line', async () => {
                let _borrowableAmount = await creditLine.callStatic.calculateBorrowableAmount(borrowerCreditLine);
                console.log({
                    _borrowableAmount: _borrowableAmount.toString(),
                });
                await incrementChain(network, 2000, 150000000);

                _borrowableAmount = await creditLine.callStatic.calculateBorrowableAmount(borrowerCreditLine);
                console.log({
                    _borrowableAmount: _borrowableAmount.toString(),
                });

                await expect(creditLine.connect(admin).liquidation(borrowerCreditLine)).to.emit(creditLine, 'CreditLineLiquidated');
            });
        });
    });
});

function print(data: any) {
    console.log(JSON.stringify(data, null, 4));
}
