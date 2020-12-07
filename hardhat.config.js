require('dotenv').config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-ganache");

require("solidity-coverage");

const INFURA_PROJECT_ID = process.env.INFURA_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

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
  mocha: {
    timeout: 50000
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
      defaultBalanceEther: 1000000,
    },
    localhost:{
      url: "http://127.0.0.1:8547",
      allowUnlimitedContractSize: true,
      gasLimit: 60000000000000,
      defaultBalanceEther: 1000000,
      gas: 9000000,	
      gasPrice: 10000000000, //10 Gwei	
    },
    ganache: {
      url: "http://127.0.0.1:7545",
      allowUnlimitedContractSize: true,
      gasLimit: 60000000000000,
      defaultBalanceEther: 1000,
      gas: 9000000,	
      gasPrice: 10000000000, //10 Gwei	
    },
    coverage: {
      url: "http://127.0.0.1:7545",
      allowUnlimitedContractSize: true,
      gasLimit: 60000000000000,
      defaultBalanceEther: 1000000,
      gas: 9000000,	
      gasPrice: 10000000000, //10 Gwei
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
