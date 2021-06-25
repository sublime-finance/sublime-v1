import { Signer } from 'ethers';

import { PoolToken } from '../../typechain/PoolToken';
import { PoolFactory } from '../../typechain/PoolFactory';
import { Pool } from '../../typechain/Pool';
import { Extension } from '../../typechain/Extension';
import { Repayments } from '../../typechain/Repayments';

import { PoolToken__factory } from '../../typechain/factories/PoolToken__factory';
import { PoolFactory__factory } from '../../typechain/factories/PoolFactory__factory';
import { Pool__factory } from '../../typechain/factories/Pool__factory';
import { Extension__factory } from '../../typechain/factories/Extension__factory';
import { Repayments__factory } from '../../typechain/factories/Repayments__factory';

import { Address } from 'hardhat-deploy/dist/types';

export default class DeployPoolContracts {
    private _deployerSigner: Signer;

    constructor(deployerSigner: Signer) {
        this._deployerSigner = deployerSigner;
    }

    public async deployRepayments(): Promise<Repayments> {
        return await new Repayments__factory(this._deployerSigner).deploy();
    }

    public async getRepayments(repaymentAddress: Address): Promise<Repayments> {
        return await new Repayments__factory(this._deployerSigner).attach(
            repaymentAddress
        );
    }

    public async deployExtenstion(): Promise<Extension> {
        return await new Extension__factory(this._deployerSigner).deploy();
    }

    public async getExtension(extensionAddress: Address): Promise<Extension> {
        return await new Extension__factory(this._deployerSigner).attach(
            extensionAddress
        );
    }

    public async deployPool(): Promise<Pool> {
        return await new Pool__factory(this._deployerSigner).deploy();
    }

    public async getPool(poolAddress: Address): Promise<Pool> {
        return await new Pool__factory(this._deployerSigner).attach(
            poolAddress
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

    public async deployPoolFactory(): Promise<PoolFactory> {
        return await new PoolFactory__factory(this._deployerSigner).deploy();
    }

    public async getPoolFactory(
        poolFactoryAddress: Address
    ): Promise<PoolFactory> {
        return await new PoolFactory__factory(this._deployerSigner).attach(
            poolFactoryAddress
        );
    }
}
