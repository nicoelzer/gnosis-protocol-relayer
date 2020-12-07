const { web3 } = require("hardhat");
const { BigNumber, utils } = require("ethers")

const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

exports.expandTo18Decimals = (n) => {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

exports.mineBlock = async (timestamp) => {
  return new Promise((resolve, reject) => {
      web3.currentProvider.send({ method: "evm_mine", params: [timestamp] }, (error) => {
          if (error) {
              console.error("error mining block", error);
              return reject(error);
          }
      });
      return resolve();
  });
};