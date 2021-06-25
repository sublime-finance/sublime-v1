import { Signer } from 'ethers';

import { SavingsAccount } from '../../typechain/SavingsAccount';
import { StrategyRegistry } from '../../typechain/StrategyRegistry';
import { AaveYield } from '../../typechain/AaveYield';
import { CompoundYield } from '../../typechain/CompoundYield';
import { YearnYield } from '../../typechain/YearnYield';
import { PoolToken } from '../../typechain/PoolToken';

import { SavingsAccount__factory } from '../../typechain/factories/SavingsAccount__factory';
import { StrategyRegistry__factory } from '../../typechain/factories/StrategyRegistry__factory';
import { AaveYield__factory } from '../../typechain/factories/AaveYield__factory';
import { CompoundYield__factory } from '../../typechain/factories/CompoundYield__factory';
import { YearnYield__factory } from '../../typechain/factories/YearnYield__factory';
import { PoolToken__factory } from '../../typechain/factories/PoolToken__factory';

import { Address } from 'hardhat-deploy/dist/types';

export default class DeployCoreContracts {
    private _deployerSigner: Signer;

    constructor(deployerSigner: Signer) {
        this._deployerSigner = deployerSigner;
    }

    public async deploySavingsAccount(): Promise<SavingsAccount> {
        return await new SavingsAccount__factory(this._deployerSigner).deploy();
    }

    public async getSavingsAccount(
        savingsAccountAddress: Address
    ): Promise<SavingsAccount> {
        return await new SavingsAccount__factory(this._deployerSigner).attach(
            savingsAccountAddress
        );
    }

    public async deployStrategyRegistry(): Promise<StrategyRegistry> {
        return await new StrategyRegistry__factory(
            this._deployerSigner
        ).deploy();
    }

    public async getStrategyRegistry(
        strategyRegistryAddress: Address
    ): Promise<StrategyRegistry> {
        return await new StrategyRegistry__factory(this._deployerSigner).attach(
            strategyRegistryAddress
        );
    }

    public async deployAaveYield(): Promise<AaveYield> {
        return await new AaveYield__factory(this._deployerSigner).deploy();
    }

    public async getAaveYield(aaveYieldAddress: Address): Promise<AaveYield> {
        return await new AaveYield__factory(this._deployerSigner).attach(
            aaveYieldAddress
        );
    }

    public async deployCompoundYield(): Promise<CompoundYield> {
        return await new CompoundYield__factory(this._deployerSigner).deploy();
    }

    public async getCompoundYield(
        compoundYieldAddress: Address
    ): Promise<CompoundYield> {
        return await new CompoundYield__factory(this._deployerSigner).attach(
            compoundYieldAddress
        );
    }

    public async deployYearnYield(): Promise<YearnYield> {
        return await new YearnYield__factory(this._deployerSigner).deploy();
    }

    public async getYearnYield(
        yearnYieldAddress: Address
    ): Promise<YearnYield> {
        return await new YearnYield__factory(this._deployerSigner).attach(
            yearnYieldAddress
        );
    }

    public async deployPoolToken(): Promise<PoolToken> {
        return await new PoolToken__factory(this._deployerSigner).deploy();
    }

    public async getPoolToken(poolTokenAddress: Address): Promise<PoolToken> {
        return await new PoolToken__factory(this._deployerSigner).attach(
            poolTokenAddress
        );
    }
}
