import { ethers, network } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { expect } from 'chai';

import {
    aaveYieldParams,
    depositValueToTest,
    ETH_Yearn_Protocol_Address,
    zeroAddress,
} from '../../utils/constants';

import DeployHelper from '../../utils/deploys';
import { SavingsAccount } from '../../typechain/SavingsAccount';
import { StrategyRegistry } from '../../typechain/StrategyRegistry';
import { getRandomFromArray, incrementChain } from '../../utils/helpers';
import { Address } from 'hardhat-deploy/dist/types';

import { AaveYield } from '../../typechain/AaveYield';
import { YearnYield } from '../../typechain/YearnYield';
import { CompoundYield } from '../../typechain/CompoundYield';
import { Contracts } from '../../existingContracts/compound.json';
import { IWETHGateway } from '../../typechain/IWETHGateway';
import { IyVault } from '../../typechain/IyVault';
import { ERC20 } from '../../typechain/ERC20';

describe('Test Savings Account (with ETH)', async () => {
    let savingsAccount: SavingsAccount;
    let strategyRegistry: StrategyRegistry;

    let mockCreditLinesAddress: SignerWithAddress;
    let proxyAdmin: SignerWithAddress;
    let admin: SignerWithAddress;

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
        strategyRegistry.initialize(admin.address, 10);
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
        });

        it('Should successfully deposit into account another account', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    zeroAddress,
                    zeroAddress
                );
            await savingsAccount
                .connect(userAccount)
                .depositTo(
                    depositValueToTest,
                    zeroAddress,
                    zeroAddress,
                    randomAccount.address,
                    { value: depositValueToTest }
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    zeroAddress,
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
                    zeroAddress,
                    zeroAddress
                );
            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        zeroAddress,
                        zeroAddress,
                        userAccount.address,
                        { value: depositValueToTest }
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    userAccount.address,
                    depositValueToTest,
                    zeroAddress,
                    zeroAddress
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    userAccount.address,
                    zeroAddress,
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
                .depositTo(depositValue, zeroAddress, zeroAddress, to, {
                    value: ethValue,
                });
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

            it('should throw error or revert if deposit amount and msg.value are different', async () => {
                await expect(
                    subject(randomAccount.address, depositValueToTest, 0)
                ).to.be.revertedWith(
                    'SavingsAccount::deposit ETH sent must be equal to amount'
                );
            });
        });
    });

    // Aave integration is skipped for now
    describe.skip('#When AaveYield is the strategy', async () => {
        let randomAccount: SignerWithAddress;
        let userAccount: SignerWithAddress;
        let withdrawAccount: SignerWithAddress;

        let aaveYield: AaveYield;
        let sharesReceivedWithAave: BigNumberish;

        before(async () => {
            randomAccount = getRandomFromArray(await ethers.getSigners());

            userAccount = getRandomFromArray(await ethers.getSigners());
            while ([randomAccount.address].includes(userAccount.address)) {
                userAccount = getRandomFromArray(await ethers.getSigners());
            }

            withdrawAccount = getRandomFromArray(await ethers.getSigners());
            while (
                [randomAccount.address, userAccount.address].includes(
                    withdrawAccount.address
                )
            ) {
                withdrawAccount = getRandomFromArray(await ethers.getSigners());
            }

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
        });

        it('Should deposit into another account', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    zeroAddress,
                    aaveYield.address
                );

            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        zeroAddress,
                        aaveYield.address,
                        randomAccount.address,
                        { value: depositValueToTest }
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    randomAccount.address,
                    depositValueToTest,
                    zeroAddress,
                    aaveYield.address
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    zeroAddress,
                    aaveYield.address
                );

            sharesReceivedWithAave = balanceLockedAfterTransaction.sub(
                balanceLockedBeforeTransaction
            );
            expect(sharesReceivedWithAave).eq(depositValueToTest);
        });

        context('Withdraw ETH', async () => {
            it('Withdraw half of shares received to account (withdrawShares = false)', async () => {
                const balanceBeforeWithdraw = await network.provider.request({
                    method: 'eth_getBalance',
                    params: [withdrawAccount.address],
                });

                await incrementChain(network, 12000);
                const sharesToWithdraw = BigNumber.from(
                    sharesReceivedWithAave
                ).div(2);
                //gas price is put to zero to check amount received
                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            withdrawAccount.address,
                            sharesToWithdraw,
                            zeroAddress,
                            aaveYield.address,
                            false,
                            { gasPrice: 0 }
                        )
                )
                    .to.emit(savingsAccount, 'Withdrawn')
                    .withArgs(
                        randomAccount.address,
                        withdrawAccount.address,
                        sharesToWithdraw,
                        zeroAddress,
                        aaveYield.address
                    );

                const balanceAfterWithdraw = await network.provider.request({
                    method: 'eth_getBalance',
                    params: [withdrawAccount.address],
                });

                const amountReceived: BigNumberish = BigNumber.from(
                    balanceAfterWithdraw
                ).sub(BigNumber.from(balanceBeforeWithdraw));

                expect(sharesToWithdraw).eq(amountReceived);

                const balanceLockedAfterTransaction: BigNumber =
                    await savingsAccount.userLockedBalance(
                        randomAccount.address,
                        zeroAddress,
                        aaveYield.address
                    );

                expect(balanceLockedAfterTransaction).eq(
                    BigNumber.from(sharesReceivedWithAave).sub(sharesToWithdraw)
                );
            });

            it('Withdraw half of shares received to account (withdrawShares = true)', async () => {
                let aaveEthLiquidityToken: string =
                    await aaveYield.liquidityToken(zeroAddress);
                await incrementChain(network, 12000);

                //can be any random number less than the available shares
                const sharesToWithdraw = BigNumber.from(
                    sharesReceivedWithAave
                ).div(2);

                const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
                const liquidityToken: ERC20 =
                    await deployHelper.mock.getMockERC20(aaveEthLiquidityToken);

                let sharesBefore = await liquidityToken.balanceOf(
                    withdrawAccount.address
                );

                //gas price is put to zero to check amount received
                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            withdrawAccount.address,
                            sharesToWithdraw,
                            zeroAddress,
                            aaveYield.address,
                            true,
                            { gasPrice: 0 }
                        )
                )
                    .to.emit(savingsAccount, 'Withdrawn')
                    .withArgs(
                        randomAccount.address,
                        withdrawAccount.address,
                        sharesToWithdraw,
                        aaveEthLiquidityToken,
                        aaveYield.address
                    );

                let sharesAfter = await liquidityToken.balanceOf(
                    withdrawAccount.address
                );
                expect(sharesAfter.sub(sharesBefore)).eq(sharesToWithdraw);
            });
        });
    });

    describe.only('#When YearnYield is the strategy', async () => {
        let randomAccount: SignerWithAddress;
        let userAccount: SignerWithAddress;
        let withdrawAccount: SignerWithAddress;

        let yearnYield: YearnYield;
        let sharesReceivedWithYearn: BigNumberish;

        before(async () => {
            randomAccount = getRandomFromArray(await ethers.getSigners());

            userAccount = getRandomFromArray(await ethers.getSigners());
            while ([randomAccount.address].includes(userAccount.address)) {
                userAccount = getRandomFromArray(await ethers.getSigners());
            }

            withdrawAccount = getRandomFromArray(await ethers.getSigners());
            while (
                [randomAccount.address, userAccount.address].includes(
                    withdrawAccount.address
                )
            ) {
                withdrawAccount = getRandomFromArray(await ethers.getSigners());
            }

            const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
            yearnYield = await deployHelper.core.deployYearnYield();

            await yearnYield.initialize(admin.address, savingsAccount.address);
            await strategyRegistry
                .connect(admin)
                .addStrategy(yearnYield.address);

            await yearnYield
                .connect(admin)
                .updateProtocolAddresses(
                    zeroAddress,
                    ETH_Yearn_Protocol_Address
                );
        });

        it('Should deposit into another account', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    zeroAddress,
                    yearnYield.address
                );
            // gas price put to test
            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        zeroAddress,
                        yearnYield.address,
                        randomAccount.address,
                        { value: depositValueToTest, gasPrice: 0 }
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    randomAccount.address,
                    depositValueToTest,
                    zeroAddress,
                    yearnYield.address
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    zeroAddress,
                    yearnYield.address
                );

            sharesReceivedWithYearn = balanceLockedAfterTransaction.sub(
                balanceLockedBeforeTransaction
            );
            expect(sharesReceivedWithYearn).lt(depositValueToTest); //@prateek to verify this
        });

        context('Withdraw ETH', async () => {
            it('Withdraw half of shares received to account (withdrawShares = false)', async () => {
                const balanceBeforeWithdraw = await network.provider.request({
                    method: 'eth_getBalance',
                    params: [withdrawAccount.address],
                });

                await incrementChain(network, 12000);
                console.log(sharesReceivedWithYearn.toString())
                const sharesToWithdraw = BigNumber.from(
                    sharesReceivedWithYearn
                ).div(2);
                //gas price is put to zero to check amount received
                let yearnEthLiquidityToken: string =
                    await yearnYield.liquidityToken(zeroAddress);
                let deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
                let vault: IyVault = await deployHelper.mock.getMockIyVault(
                    yearnEthLiquidityToken
                );

                let expectedEthToBeReleased = (
                    await vault.getPricePerFullShare()
                )
                    .mul(sharesToWithdraw)
                    .div('1000000000000000000');
                console.log({expectedEthToBeReleased: expectedEthToBeReleased.toString(), sharesToWithdraw: sharesToWithdraw.toString()});

                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            withdrawAccount.address,
                            expectedEthToBeReleased,
                            zeroAddress,
                            yearnYield.address,
                            false,
                            { gasPrice: 0 }
                        )
                )
                    .to.emit(savingsAccount, 'Withdrawn')
                    .withArgs(
                        randomAccount.address,
                        withdrawAccount.address,
                        expectedEthToBeReleased,
                        zeroAddress,
                        yearnYield.address
                    );

                const balanceAfterWithdraw = await network.provider.request({
                    method: 'eth_getBalance',
                    params: [withdrawAccount.address],
                });

                const amountReceived: BigNumberish = BigNumber.from(
                    balanceAfterWithdraw
                ).sub(BigNumber.from(balanceBeforeWithdraw));
                expect(expectedEthToBeReleased).eq(amountReceived);
            });

            it('Withdraw half of shares received to account (withdrawShares = true)', async () => {
                let yearnEthLiquidityToken: string =
                    await yearnYield.liquidityToken(zeroAddress);

                await incrementChain(network, 12000);
                // try to make this random
                const sharesToWithdraw = BigNumber.from(
                    sharesReceivedWithYearn
                ).div(2);

                const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
                const liquidityToken: ERC20 =
                    await deployHelper.mock.getMockERC20(
                        yearnEthLiquidityToken
                    );

                let sharesBefore = await liquidityToken.balanceOf(
                    withdrawAccount.address
                );
                //gas price is put to zero to check amount received

                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            withdrawAccount.address,
                            sharesToWithdraw,
                            zeroAddress,
                            yearnYield.address,
                            true,
                            { gasPrice: 0 }
                        )
                )
                    .to.emit(savingsAccount, 'Withdrawn')
                    .withArgs(
                        randomAccount.address,
                        withdrawAccount.address,
                        sharesToWithdraw,
                        yearnEthLiquidityToken,
                        yearnYield.address
                    );

                let sharesAfter = await liquidityToken.balanceOf(
                    withdrawAccount.address
                );
                expect(sharesAfter.sub(sharesBefore)).eq(sharesToWithdraw);
            });
        });
    });

    describe('#When CompoundYield is the strategy', async () => {
        let randomAccount: SignerWithAddress;
        let userAccount: SignerWithAddress;
        let withdrawAccount: SignerWithAddress;

        let compoundYield: CompoundYield;
        let sharesReceivedWithCompound: BigNumberish;

        before(async () => {
            randomAccount = getRandomFromArray(await ethers.getSigners());

            userAccount = getRandomFromArray(await ethers.getSigners());
            while ([randomAccount.address].includes(userAccount.address)) {
                userAccount = getRandomFromArray(await ethers.getSigners());
            }

            withdrawAccount = getRandomFromArray(await ethers.getSigners());
            while (
                [randomAccount.address, userAccount.address].includes(
                    withdrawAccount.address
                )
            ) {
                withdrawAccount = getRandomFromArray(await ethers.getSigners());
            }

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
                .updateProtocolAddresses(zeroAddress, Contracts.cETH);
        });
        it('Should deposit into another account', async () => {
            const balanceLockedBeforeTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    zeroAddress,
                    compoundYield.address
                );
            await expect(
                savingsAccount
                    .connect(userAccount)
                    .depositTo(
                        depositValueToTest,
                        zeroAddress,
                        compoundYield.address,
                        randomAccount.address,
                        { value: depositValueToTest }
                    )
            )
                .to.emit(savingsAccount, 'Deposited')
                .withArgs(
                    randomAccount.address,
                    depositValueToTest,
                    zeroAddress,
                    compoundYield.address
                );

            const balanceLockedAfterTransaction: BigNumber =
                await savingsAccount.userLockedBalance(
                    randomAccount.address,
                    zeroAddress,
                    compoundYield.address
                );

            sharesReceivedWithCompound = balanceLockedAfterTransaction.sub(
                balanceLockedBeforeTransaction
            );
        });

        context('Withdraw ETH', async () => {
            it('Withdraw half of shares received to account (withdrawShares = false)', async () => {
                const balanceBeforeWithdraw = await network.provider.request({
                    method: 'eth_getBalance',
                    params: [withdrawAccount.address],
                });

                await incrementChain(network, 12000);
                const sharesToWithdraw = BigNumber.from(
                    sharesReceivedWithCompound
                ).div(2);

                //gas price is put to zero to check amount received
                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            withdrawAccount.address,
                            sharesToWithdraw,
                            zeroAddress,
                            compoundYield.address,
                            false,
                            { gasPrice: 0 }
                        )
                ).to.emit(savingsAccount, 'Withdrawn');

                const balanceAfterWithdraw = await network.provider.request({
                    method: 'eth_getBalance',
                    params: [withdrawAccount.address],
                });

                const amountReceived: BigNumberish = BigNumber.from(
                    balanceAfterWithdraw
                ).sub(BigNumber.from(balanceBeforeWithdraw));

                expect(amountReceived).gte(depositValueToTest.div(2));
            });

            it('Withdraw half of shares received to account (withdrawShares = true)', async () => {
                let compoundEthLiquidityToken: string =
                    await compoundYield.liquidityToken(zeroAddress);

                await incrementChain(network, 12000);
                const sharesToWithdraw = BigNumber.from(
                    sharesReceivedWithCompound
                ).div(2);

                const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
                const liquidityToken: ERC20 =
                    await deployHelper.mock.getMockERC20(
                        compoundEthLiquidityToken
                    );

                let sharesBefore = await liquidityToken.balanceOf(
                    withdrawAccount.address
                );
                //gas price is put to zero to check amount received
                await expect(
                    savingsAccount
                        .connect(randomAccount)
                        .withdraw(
                            withdrawAccount.address,
                            sharesToWithdraw,
                            zeroAddress,
                            compoundYield.address,
                            true,
                            { gasPrice: 0 }
                        )
                )
                    .to.emit(savingsAccount, 'Withdrawn')
                    .withArgs(
                        randomAccount.address,
                        withdrawAccount.address,
                        sharesToWithdraw,
                        compoundEthLiquidityToken,
                        compoundYield.address
                    );
                let sharesAfter = await liquidityToken.balanceOf(
                    withdrawAccount.address
                );
                expect(sharesAfter.sub(sharesBefore)).eq(sharesToWithdraw);
            });
        });
    });
});
