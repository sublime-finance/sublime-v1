import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';

import DeployHelper from '../../utils/deploys';
import { PoolToken } from '../../typechain/PoolToken';

describe('Pool Token', async () => {
    let proxyAdmin: SignerWithAddress;
    let admin: SignerWithAddress;
    let dummyPool: SignerWithAddress;
    let poolToken: PoolToken;

    let poolTokenName = 'Pool Token';
    let poolTokenSymbol = 'PT';

    before(async () => {
        [proxyAdmin, admin, dummyPool] = await ethers.getSigners();
        const deployHelper: DeployHelper = new DeployHelper(proxyAdmin);
        poolToken = await deployHelper.pool.deployPoolToken();
        await poolToken
            .connect(admin)
            ['initialize(string,string,address)'](
                poolTokenName,
                poolTokenSymbol,
                dummyPool.address
            );
    });

    it('Check Params', async () => {
        expect(await poolToken.symbol()).eq(poolTokenSymbol);
        expect(await poolToken.name()).eq(poolTokenName);
    });

    it.skip('Write other relevant tests', async () => {});
});
