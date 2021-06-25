console.log('this is test');
import { ethers, network } from 'hardhat';

import DeployHelper from '../utils/deploys';

async function init() {
    let addresses = await ethers.getSigners();
    console.log({ totalAddresses: addresses.length });
    const deployHelper: DeployHelper = new DeployHelper(addresses[0]);
}

init();
