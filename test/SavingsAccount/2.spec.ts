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
} from '../../utils/constants';
import DeployHelper from '../../utils/deploys';

import { SavingsAccount } from '../../typechain/SavingsAccount';
import { StrategyRegistry } from '../../typechain/StrategyRegistry';
import { getRandomFromArray, incrementChain } from '../../utils/helpers';
import { Address } from 'hardhat-deploy/dist/types';
import { AaveYield } from '../../typechain/AaveYield';
import { YearnYield } from '../../typechain/YearnYield';
import { CompoundYield } from '../../typechain/CompoundYield';
import { ERC20 } from '../../typechain/ERC20';

import { Contracts } from '../../existingContracts/compound.json';

describe('Test Savings Account (with ERC20 Token)', async () => {
    let savingsAccount: SavingsAccount;
    let strategyRegistry: StrategyRegistry;

    let mockCreditLinesAddress: SignerWithAddress;
    let proxyAdmin: SignerWithAddress;
    let admin: SignerWithAddress;

    let BatTokenContract: ERC20;
    let LinkTokenContract: ERC20;
    let DaiTokenContract: ERC20;

    let Binance7: any;
    let WhaleAccount: any;

    before(async () => {
        [proxyAdmin, admin, mockCreditLinesAddress] = await ethers.getSigners();
        const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
        savingsAccount = await deployHelper.core.deploySavingsAccount();
        strategyRegistry = await deployHelper.core.deployStrategyRegistry();

        //initialize
        savingsAccount.initialize(
            admin.address,
            strategyRegistry.address,
            mockCreditLinesAddress.address
        );
        strategyRegistry.initialize(admin.address, 1000);

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
    });

    describe('# When NO STRATEGY is preferred', async () => {
        let randomAccount: SignerWithAddress;
        let userAccount: SignerWithAddress;

        beforeEach(async () => {
            randomAccount = getRandomFromArray(await ethers.getSigners());
            userAccount = getRandomFromArray(await ethers.getSigners());

            while ([randomAccount.address].includes(userAccount.address)) {
                userAccount = getRandomFromArray(await ethers.getSigners());
            }
            await BatTokenContract.connect(admin).transfer(
                userAccount.address,
                depositValueToTest
            );
            await BatTokenContract.connect(userAccount).approve(
                savingsAccount.address,
                depositValueToTest
            );
        });

        it('Should successfully deposit into account another account', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    Contracts.BAT,
                    zeroAddress
                );
            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.BAT,
                        zeroAddress,
                        randomAccount.address
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    randomAccount.address,
                    depositValueToTest,
                    Contracts.BAT,
                    zeroAddress
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    Contracts.BAT,
                    zeroAddress
                );

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(depositValueToTest);
        });

        it('Should successfully deposit into its own accounts', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    Contracts.BAT,
                    zeroAddress
                );
            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.BAT,
                        zeroAddress,
                        userAccount.address
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    userAccount.address,
                    depositValueToTest,
                    Contracts.BAT,
                    zeroAddress
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    Contracts.BAT,
                    zeroAddress
                );

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(depositValueToTest);
        });

        async function subject(
            to: Address,
            depositValue: BigNumberish,
            ethValue?: BigNumberish
        ): Promise<any> {
            return savingsAccount
                .connect(userAccount)
                .depositTo(depositValue, Contracts.BAT, zeroAddress, to);
        }

        describe('Failed cases', async () => {
            it('Should throw error or revert if receiver address is zero_address', async () => {
                await expect(
                    subject(zeroAddress, depositValueToTest)
                ).to.be.revertedWith(
                    'SavingsAccount::depositTo receiver address should not be zero address'
                );
            });

            it('should throw error or revert if deposit value is 0', async () => {
                await expect(
                    subject(randomAccount.address, 0)
                ).to.be.revertedWith(
                    'SavingsAccount::_deposit Amount must be greater than zero'
                );
            });
        });

        it('Withdraw Token (withdrawShares = false)', async () => {
            await savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValueToTest,
                    Contracts.BAT,
                    zeroAddress,
                    randomAccount.address
                );

            const balanceLockedBeforeTransaction: BigNumber =
                await BatTokenContract.balanceOf(randomAccount.address);

            await expect(
                savingsAccount
                    .connect(randomAccount)
                    .withdraw(
                        randomAccount.address,
                        depositValueToTest,
                        Contracts.BAT,
                        zeroAddress,
                        false,
                        { gasPrice: 0 }
                    )
            )
                .to.emit(savingsAccount, 'Withdrawn')
                .withArgs(
                    randomAccount.address,
                    randomAccount.address,
                    depositValueToTest,
                    Contracts.BAT,
                    zeroAddress
                );

            const balanceLockedAfterTransaction: BigNumber =
                await BatTokenContract.balanceOf(randomAccount.address);

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(depositValueToTest);
        });
    });

    // skip aave integration
    describe.skip('# When Aave STRATEGY is preferred', async () => {
        let randomAccount: SignerWithAddress;
        let userAccount: SignerWithAddress;
        let aaveYield: AaveYield;

        beforeEach(async () => {
            const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
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

            await strategyRegistry
                .connect(admin)
                .addStrategy(aaveYield.address);

            randomAccount = getRandomFromArray(await ethers.getSigners());
            userAccount = getRandomFromArray(await ethers.getSigners());

            while ([randomAccount.address].includes(userAccount.address)) {
                userAccount = getRandomFromArray(await ethers.getSigners());
            }
            await LinkTokenContract.connect(admin).transfer(
                userAccount.address,
                depositValueToTest
            );
            await LinkTokenContract.connect(userAccount).approve(
                savingsAccount.address,
                depositValueToTest
            );
            await LinkTokenContract.connect(userAccount).approve(
                aaveYield.address,
                depositValueToTest
            );
        });

        it('Should successfully deposit into account another account', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    Contracts.LINK,
                    aaveYield.address
                );
            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.LINK,
                        aaveYield.address,
                        randomAccount.address
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    randomAccount.address,
                    depositValueToTest,
                    ethers.utils.getAddress(Contracts.LINK),
                    aaveYield.address
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    Contracts.LINK,
                    aaveYield.address
                );

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(depositValueToTest);
        });

        it('Should successfully deposit into its own accounts', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    Contracts.LINK,
                    aaveYield.address
                );
            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.LINK,
                        aaveYield.address,
                        userAccount.address
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    userAccount.address,
                    depositValueToTest,
                    ethers.utils.getAddress(Contracts.LINK),
                    aaveYield.address
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    Contracts.LINK,
                    aaveYield.address
                );
            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(depositValueToTest);
        });

        async function subject(
            to: Address,
            depositValue: BigNumberish
        ): Promise<any> {
            return savingsAccount
                .connect(userAccount)
                .depositTo(depositValue, Contracts.LINK, aaveYield.address, to);
        }

        describe('Failed cases', async () => {
            it('Should throw error or revert if receiver address is zero_address', async () => {
                await expect(
                    subject(zeroAddress, depositValueToTest)
                ).to.be.revertedWith(
                    'SavingsAccount::depositTo receiver address should not be zero address'
                );
            });

            it('should throw error or revert if deposit value is 0', async () => {
                await expect(
                    subject(randomAccount.address, 0)
                ).to.be.revertedWith(
                    'SavingsAccount::_deposit Amount must be greater than zero'
                );
            });
            it('should fail/revert Withdraw Token (withdrawShares = false) if more than withdrawable balance is tried to pull', async () => {
                await savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.LINK,
                        aaveYield.address,
                        randomAccount.address
                    );

                const balanceToWithdraw =
                    await savingsAccount.userLockedBalance(
                        randomAccount.address,
                        Contracts.LINK,
                        aaveYield.address
                    );

                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            randomAccount.address,
                            balanceToWithdraw.mul(2),
                            Contracts.LINK,
                            aaveYield.address,
                            false
                        )
                ).to.be.revertedWith(
                    'SavingsAccount::withdraw Insufficient amount'
                );
            });
            it('should fail/revert Withdraw Token (withdrawShares = true) if more than withdrawable balance is tried to pull', async () => {
                await savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.LINK,
                        aaveYield.address,
                        randomAccount.address
                    );

                const balanceToWithdraw =
                    await savingsAccount.userLockedBalance(
                        randomAccount.address,
                        Contracts.LINK,
                        aaveYield.address
                    );

                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            randomAccount.address,
                            balanceToWithdraw.mul(2),
                            Contracts.LINK,
                            aaveYield.address,
                            true
                        )
                ).to.be.revertedWith(
                    'SavingsAccount::withdraw Insufficient amount'
                );
            });
        });

        it('Withdraw Token (withdrawShares = false)', async () => {
            await savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValueToTest,
                    Contracts.LINK,
                    aaveYield.address,
                    randomAccount.address
                );

            await incrementChain(network, 12000);

            const balanceLockedBeforeTransaction: BigNumber =
                await LinkTokenContract.balanceOf(randomAccount.address);

            const balanceToWithdraw = await savingsAccount.userLockedBalance(
                randomAccount.address,
                Contracts.LINK,
                aaveYield.address
            );
            // console.log({ balanceToWithdraw: balanceToWithdraw.toString() });

            await expect(
                savingsAccount
                    .connect(randomAccount)
                    .withdraw(
                        randomAccount.address,
                        balanceToWithdraw,
                        Contracts.LINK,
                        aaveYield.address,
                        false
                    )
            )
                .to.emit(savingsAccount, 'Withdrawn')
                .withArgs(
                    randomAccount.address,
                    randomAccount.address,
                    depositValueToTest,
                    ethers.utils.getAddress(Contracts.LINK),
                    aaveYield.address
                );

            const balanceLockedAfterTransaction: BigNumber =
                await LinkTokenContract.balanceOf(randomAccount.address);

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(depositValueToTest);
        });

        it('Withdraw Token (withdrawShares = true)', async () => {
            let linkLiquidityToken = await aaveYield.liquidityToken(
                Contracts.LINK
            );
            const deployHelper = new DeployHelper(proxyAdmin);
            let liquidityToken = await deployHelper.mock.getMockERC20(
                linkLiquidityToken
            );

            await savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValueToTest,
                    Contracts.LINK,
                    aaveYield.address,
                    randomAccount.address
                );
            await incrementChain(network, 12000);

            let liquidityTokenBalanceBefore = await liquidityToken.balanceOf(
                randomAccount.address
            );

            const balanceToWithdraw = await savingsAccount.userLockedBalance(
                randomAccount.address,
                Contracts.LINK,
                aaveYield.address
            );

            await expect(
                savingsAccount
                    .connect(randomAccount)
                    .withdraw(
                        randomAccount.address,
                        balanceToWithdraw,
                        Contracts.LINK,
                        aaveYield.address,
                        true,
                        { gasPrice: 0 }
                    )
            )
                .to.emit(savingsAccount, 'Withdrawn')
                .withArgs(
                    randomAccount.address,
                    randomAccount.address,
                    depositValueToTest,
                    ethers.utils.getAddress(linkLiquidityToken),
                    aaveYield.address
                );
            let liquidityTokenBalanceAfter = await liquidityToken.balanceOf(
                randomAccount.address
            );
            expect(
                liquidityTokenBalanceAfter.sub(liquidityTokenBalanceBefore)
            ).eq(depositValueToTest);
        });
    });

    describe('# When Yearn STRATEGY is preferred', async () => {
        let randomAccount: SignerWithAddress;
        let userAccount: SignerWithAddress;
        let yearnYield: YearnYield;

        beforeEach(async () => {
            const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
            yearnYield = await deployHelper.core.deployYearnYield();
            await yearnYield.initialize(admin.address, savingsAccount.address);
            await strategyRegistry
                .connect(admin)
                .addStrategy(yearnYield.address);
            await yearnYield
                .connect(admin)
                .updateProtocolAddresses(
                    DaiTokenContract.address,
                    DAI_Yearn_Protocol_Address
                );
            randomAccount = getRandomFromArray(await ethers.getSigners());
            userAccount = getRandomFromArray(await ethers.getSigners());

            while ([randomAccount.address].includes(userAccount.address)) {
                userAccount = getRandomFromArray(await ethers.getSigners());
            }
            await DaiTokenContract.connect(admin).transfer(
                userAccount.address,
                depositValueToTest
            );
            await DaiTokenContract.connect(userAccount).approve(
                savingsAccount.address,
                depositValueToTest
            );
            await DaiTokenContract.connect(userAccount).approve(
                yearnYield.address,
                depositValueToTest
            );
        });

        it('Should successfully deposit into account another account', async () => {
            let expectedShares = await yearnYield.getSharesForTokens(
                depositValueToTest,
                Contracts.DAI
            );

            const sharesLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    Contracts.DAI,
                    yearnYield.address
                );

            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.DAI,
                        yearnYield.address,
                        randomAccount.address
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    randomAccount.address,
                    depositValueToTest,
                    ethers.utils.getAddress(Contracts.DAI),
                    yearnYield.address
                );

            const sharesLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    Contracts.DAI,
                    yearnYield.address
                );

            expect(
                sharesLockedAfterTransaction.sub(sharesLockedBeforeTransaction)
            ).gt(0);

            expect(
                sharesLockedAfterTransaction.sub(sharesLockedBeforeTransaction)
            ).lte(expectedShares);
        });

        it('Should successfully deposit into its own accounts', async () => {
            let expectedShares = await yearnYield.getSharesForTokens(
                depositValueToTest,
                Contracts.DAI
            );

            const sharesLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    Contracts.DAI,
                    yearnYield.address
                );

            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.DAI,
                        yearnYield.address,
                        userAccount.address
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    userAccount.address,
                    depositValueToTest,
                    ethers.utils.getAddress(Contracts.DAI),
                    yearnYield.address
                );

            const sharesLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    Contracts.DAI,
                    yearnYield.address
                );

            expect(
                sharesLockedAfterTransaction.sub(sharesLockedBeforeTransaction)
            ).gt(0);

            expect(
                sharesLockedAfterTransaction.sub(sharesLockedBeforeTransaction)
            ).lte(expectedShares);
        });

        async function subject(
            to: Address,
            depositValue: BigNumberish
        ): Promise<any> {
            return savingsAccount
                .connect(userAccount)
                .depositTo(depositValue, Contracts.DAI, yearnYield.address, to);
        }

        describe('Failed cases', async () => {
            it('Should throw error or revert if receiver address is zero_address', async () => {
                await expect(
                    subject(zeroAddress, depositValueToTest)
                ).to.be.revertedWith(
                    'SavingsAccount::depositTo receiver address should not be zero address'
                );
            });

            it('should throw error or revert if deposit value is 0', async () => {
                await expect(
                    subject(randomAccount.address, 0)
                ).to.be.revertedWith(
                    'SavingsAccount::_deposit Amount must be greater than zero'
                );
            });
            it('should fail/revert Withdraw Token (withdrawShares = false) if more than withdrawable balance is tried to pull', async () => {
                await savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.DAI,
                        yearnYield.address,
                        randomAccount.address
                    );

                const balanceToWithdraw =
                    await savingsAccount.userLockedBalance(
                        randomAccount.address,
                        Contracts.DAI,
                        yearnYield.address
                    );

                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            randomAccount.address,
                            balanceToWithdraw.mul(2),
                            Contracts.DAI,
                            yearnYield.address,
                            false
                        )
                ).to.be.revertedWith(
                    'SavingsAccount::withdraw Insufficient amount'
                );
            });
            it('should fail/revert Withdraw Token (withdrawShares = true) if more than withdrawable balance is tried to pull', async () => {
                await savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.DAI,
                        yearnYield.address,
                        randomAccount.address
                    );

                const balanceToWithdraw =
                    await savingsAccount.userLockedBalance(
                        randomAccount.address,
                        Contracts.DAI,
                        yearnYield.address
                    );

                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            randomAccount.address,
                            balanceToWithdraw.mul(2),
                            Contracts.DAI,
                            yearnYield.address,
                            true
                        )
                ).to.be.revertedWith(
                    'SavingsAccount::withdraw Insufficient amount'
                );
            });
        });

        it('Withdraw Token (withdrawShares = false)', async () => {
            await savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValueToTest,
                    Contracts.DAI,
                    yearnYield.address,
                    randomAccount.address
                );

            const balanceLockedBeforeTransaction: BigNumber =
                await DaiTokenContract.balanceOf(randomAccount.address);

            const balanceToWithdraw = await savingsAccount.userLockedBalance(
                randomAccount.address,
                Contracts.DAI,
                yearnYield.address
            );

            let expectedBalanceWithdraw = await yearnYield.getTokensForShares(
                await yearnYield.getSharesForTokens(
                    depositValueToTest,
                    Contracts.DAI
                ),
                Contracts.DAI
            );
            await expect(
                savingsAccount
                    .connect(randomAccount)
                    .withdraw(
                        randomAccount.address,
                        balanceToWithdraw,
                        Contracts.DAI,
                        yearnYield.address,
                        false
                    )
            )
                .to.emit(savingsAccount, 'Withdrawn')
                .withArgs(
                    randomAccount.address,
                    randomAccount.address,
                    expectedBalanceWithdraw,
                    ethers.utils.getAddress(Contracts.DAI),
                    yearnYield.address
                );

            const balanceLockedAfterTransaction: BigNumber =
                await DaiTokenContract.balanceOf(randomAccount.address);

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(expectedBalanceWithdraw);
        });

        it('Withdraw Token (withdrawShares = true)', async () => {
            let liquidityTokenAddress = await yearnYield.liquidityToken(
                Contracts.DAI
            );

            const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
            let liquidityToken = await deployHelper.mock.getMockERC20(
                liquidityTokenAddress
            );

            let sharesBefore = await liquidityToken.balanceOf(
                randomAccount.address
            );

            await savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValueToTest,
                    Contracts.DAI,
                    yearnYield.address,
                    randomAccount.address
                );

            const balanceToWithdraw = await savingsAccount.userLockedBalance(
                randomAccount.address,
                Contracts.DAI,
                yearnYield.address
            );

            await expect(
                savingsAccount
                    .connect(randomAccount)
                    .withdraw(
                        randomAccount.address,
                        balanceToWithdraw,
                        Contracts.DAI,
                        yearnYield.address,
                        true
                    )
            )
                .to.emit(savingsAccount, 'Withdrawn')
                .withArgs(
                    randomAccount.address,
                    randomAccount.address,
                    balanceToWithdraw,
                    ethers.utils.getAddress(liquidityTokenAddress),
                    yearnYield.address
                );

            let sharesAfter = await liquidityToken.balanceOf(
                randomAccount.address
            );

            expect(sharesAfter.sub(sharesBefore)).eq(balanceToWithdraw);
        });
    });

    describe('# When Compound STRATEGY is preferred', async () => {
        let randomAccount: SignerWithAddress;
        let userAccount: SignerWithAddress;
        let compoundYield: CompoundYield;

        beforeEach(async () => {
            const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
            compoundYield = await deployHelper.core.deployCompoundYield();
            await compoundYield.initialize(
                admin.address,
                savingsAccount.address
            );
            await strategyRegistry
                .connect(admin)
                .addStrategy(compoundYield.address);
            await compoundYield
                .connect(admin)
                .updateProtocolAddresses(Contracts.DAI, Contracts.cDAI);

            randomAccount = getRandomFromArray(await ethers.getSigners());
            userAccount = getRandomFromArray(await ethers.getSigners());

            while ([randomAccount.address].includes(userAccount.address)) {
                userAccount = getRandomFromArray(await ethers.getSigners());
            }
            await DaiTokenContract.connect(admin).transfer(
                userAccount.address,
                depositValueToTest
            );
            await DaiTokenContract.connect(userAccount).approve(
                savingsAccount.address,
                depositValueToTest
            );
            await DaiTokenContract.connect(userAccount).approve(
                compoundYield.address,
                depositValueToTest
            );
        });

        it('Should successfully deposit into account another account', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    Contracts.DAI,
                    compoundYield.address
                );

            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.DAI,
                        compoundYield.address,
                        randomAccount.address
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    randomAccount.address,
                    depositValueToTest,
                    ethers.utils.getAddress(Contracts.DAI),
                    compoundYield.address
                );

            let expectedValue =
                await compoundYield.callStatic.getSharesForTokens(
                    depositValueToTest,
                    Contracts.DAI
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    Contracts.DAI,
                    compoundYield.address
                );

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(expectedValue);
        });

        it('Should successfully deposit into its own accounts', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    Contracts.DAI,
                    compoundYield.address
                );
            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.DAI,
                        compoundYield.address,
                        userAccount.address
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    userAccount.address,
                    depositValueToTest,
                    ethers.utils.getAddress(Contracts.DAI),
                    compoundYield.address
                );

            let expectedValue =
                await compoundYield.callStatic.getSharesForTokens(
                    depositValueToTest,
                    Contracts.DAI
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    Contracts.DAI,
                    compoundYield.address
                );

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).eq(expectedValue);
        });

        async function subject(
            to: Address,
            depositValue: BigNumberish
        ): Promise<any> {
            return savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValue,
                    Contracts.DAI,
                    compoundYield.address,
                    to
                );
        }

        describe('Failed cases', async () => {
            it('Should throw error or revert if receiver address is zero_address', async () => {
                await expect(
                    subject(zeroAddress, depositValueToTest)
                ).to.be.revertedWith(
                    'SavingsAccount::depositTo receiver address should not be zero address'
                );
            });

            it('should throw error or revert if deposit value is 0', async () => {
                await expect(
                    subject(randomAccount.address, 0)
                ).to.be.revertedWith(
                    'SavingsAccount::_deposit Amount must be greater than zero'
                );
            });
            it('should fail/revert Withdraw Token (withdrawShares = false) if more than withdrawable balance is tried to pull', async () => {
                await savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.DAI,
                        compoundYield.address,
                        randomAccount.address
                    );

                const balanceToWithdraw =
                    await savingsAccount.userLockedBalance(
                        randomAccount.address,
                        Contracts.DAI,
                        compoundYield.address
                    );

                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            randomAccount.address,
                            balanceToWithdraw.mul(2),
                            Contracts.DAI,
                            compoundYield.address,
                            false
                        )
                ).to.be.revertedWith(
                    'SavingsAccount::withdraw Insufficient amount'
                );
            });
            it('should fail/revert Withdraw Token (withdrawShares = true) if more than withdrawable balance is tried to pull', async () => {
                await savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        Contracts.DAI,
                        compoundYield.address,
                        randomAccount.address
                    );

                const balanceToWithdraw =
                    await savingsAccount.userLockedBalance(
                        randomAccount.address,
                        Contracts.DAI,
                        compoundYield.address
                    );

                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            randomAccount.address,
                            balanceToWithdraw.mul(2),
                            Contracts.DAI,
                            compoundYield.address,
                            true
                        )
                ).to.be.revertedWith(
                    'SavingsAccount::withdraw Insufficient amount'
                );
            });
        });

        it('Withdraw Token (withdrawShares = false)', async () => {
            await savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValueToTest,
                    Contracts.DAI,
                    compoundYield.address,
                    randomAccount.address
                );

            const balanceLockedBeforeTransaction: BigNumber =
                await DaiTokenContract.balanceOf(randomAccount.address);

            const sharesToWithdraw = await savingsAccount.userLockedBalance(
                randomAccount.address,
                Contracts.DAI,
                compoundYield.address
            );
            await incrementChain(network, 12000);

            let expectedValue =
                await compoundYield.callStatic.getTokensForShares(
                    sharesToWithdraw,
                    Contracts.DAI
                );

            await expect(
                savingsAccount
                    .connect(randomAccount)
                    .withdraw(
                        randomAccount.address,
                        sharesToWithdraw,
                        Contracts.DAI,
                        compoundYield.address,
                        false
                    )
            ).to.emit(savingsAccount, 'Withdrawn');

            const balanceLockedAfterTransaction: BigNumber =
                await DaiTokenContract.balanceOf(randomAccount.address);

            let delta = '1000000000000';
            let lowerRange = expectedValue.sub(delta);
            let upperRange = expectedValue.add(delta);
            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).gte(lowerRange);

            expect(
                balanceLockedAfterTransaction.sub(
                    balanceLockedBeforeTransaction
                )
            ).lte(upperRange);
        });

        it('Withdraw Token (withdrawShares = true)', async () => {
            const liquidityTokenAddress = await compoundYield.liquidityToken(
                Contracts.DAI
            );
            const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
            const liquidityToken = await deployHelper.mock.getMockERC20(
                liquidityTokenAddress
            );

            await savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValueToTest,
                    Contracts.DAI,
                    compoundYield.address,
                    randomAccount.address
                );

            const sharesBeforeTransaction: BigNumber =
                await liquidityToken.balanceOf(randomAccount.address);

            const balanceToWithdraw = await savingsAccount.userLockedBalance(
                randomAccount.address,
                Contracts.DAI,
                compoundYield.address
            );

            await expect(
                savingsAccount
                    .connect(randomAccount)
                    .withdraw(
                        randomAccount.address,
                        balanceToWithdraw,
                        Contracts.DAI,
                        compoundYield.address,
                        true
                    )
            )
                .to.emit(savingsAccount, 'Withdrawn')
                .withArgs(
                    randomAccount.address,
                    randomAccount.address,
                    balanceToWithdraw,
                    ethers.utils.getAddress(liquidityTokenAddress),
                    compoundYield.address
                );

            const sharesAfterTransaction: BigNumber =
                await liquidityToken.balanceOf(randomAccount.address);

            expect(sharesAfterTransaction.sub(sharesBeforeTransaction)).eq(
                balanceToWithdraw
            );
        });
    });
});
