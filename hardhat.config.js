require('dotenv').config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-ganache");
require("solidity-coverage");

const INFURA_PROJECT_ID = process.env.INFURA_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

module.exports = {
  solidity: {
    version: "0.6.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      defaultBalanceEther: 200,
    },
    localhost:{
      url: "http://127.0.0.1:8547",
      allowUnlimitedContractSize: true,
      defaultBalanceEther: 200,
    },
    ganache: {
      url: "http://127.0.0.1:7545",
      allowUnlimitedContractSize: true,
      defaultBalanceEther: 200,
    },
    coverage: {
      url: "http://127.0.0.1:7545",
      allowUnlimitedContractSize: true,
      defaultBalanceEther: 200,
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [PRIVATE_KEY]
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [PRIVATE_KEY]
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [PRIVATE_KEY]
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [PRIVATE_KEY]
    }
  }
};
