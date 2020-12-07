const { ethers, waffle, network, web3 } = require("hardhat");
const { deployContract } = waffle;
const { Contract, BigNumber, utils } = require("ethers")
const { Web3Provider, JsonRpcProvider } = require("@ethersproject/providers")

const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

exports.expandTo18Decimals = (n) => {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}


exports.getDomainSeparator = async (name, tokenAddress) => {
  return utils.keccak256(
    utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        utils.keccak256(utils.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        utils.keccak256(utils.toUtf8Bytes(name)),
        utils.keccak256(utils.toUtf8Bytes('1')),
        1,
        tokenAddress
      ]
    )
  )
}

exports.getApprovalDigest = async (
  token,
  approve,
  nonce,
  deadline
) => {
  const name = await token.name()
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address)
  return utils.keccak256(
    utils.solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        utils.keccak256(
          utils.defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
          )
        )
      ]
    )
  )
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

exports.encodePrice = async (reserve0, reserve1) => {
  return [reserve1.mul(BigNumber.from(2).pow(112)).div(reserve0), reserve0.mul(BigNumber.from(2).pow(112)).div(reserve1)]
}