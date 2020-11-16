require('dotenv').config();
require("babel-polyfill");
require("babel-register")({
  "presets": [ "es2015" ],
  "plugins": [ "syntax-async-functions", "transform-regenerator" ]
});
usePlugin('@nomiclabs/buidler-truffle5');
usePlugin('buidler-gas-reporter');
usePlugin('solidity-coverage');

const INFURA_PROJECT_ID = process.env.PROTOTYPE_BR_INFURA_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

module.exports = {
  solc: {
    version: '0.5.17',
    optimizer: {
      enabled: true,
      runs: 200
    }
  },
  gasReporter: {
    currency: 'USD',
    enabled: process.env.ENABLE_GAS_REPORTER === 'true'
  },
  networks: {
    buidlerevm: {
      gasPrice: 8000000000, // 8 gwei
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [`0x${PRIVATE_KEY}`]
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [`0x${PRIVATE_KEY}`]
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [`0x${PRIVATE_KEY}`]
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [`0x${PRIVATE_KEY}`]
    },
    coverage: {
      url: 'http://localhost:8555',
      gasPrice: 8000000000, // 8 gwei
    }
  }
};