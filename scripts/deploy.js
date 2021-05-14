const { contract, ethers, network } = require("hardhat");


async function main() {
  console.log(`Deploying on network: ${network.name}`)

  // Get contracts to deploy
  const OracleCreator = await ethers.getContractFactory("OracleCreator");
  const GnosisProtocolRelayer = await ethers.getContractFactory(
    "GnosisProtocolRelayer"
  );

  let owner,
  batchExchange,
  epochTokenLocker,
  swaprFactory,
  uniswapFactory,
  honeyswapFactory,
  ammWhitelist,
  WETH;

  switch (network.name) {
    case "mainnet":
      WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
      owner = "0x519b70055af55a007110b4ff99b0ea33071c720a";
      batchExchange = "0x6f400810b62df8e13fded51be75ff5393eaa841f";
      epochTokenLocker = "0x6f400810b62df8e13fded51be75ff5393eaa841f";
      swaprFactory = "0xd34971bab6e5e356fd250715f5de0492bb070452";
      uniswapFactory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
      sushiswapFactory = "0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac"
      ammWhitelist = [swaprFactory,uniswapFactory,sushiswapFactory,];
      break;
    case "xdai":
      WETH = "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d";
      owner = "0xe716ec63c5673b3a4732d22909b38d779fa47c3f";
      batchExchange = "0x25B06305CC4ec6AfCF3E7c0b673da1EF8ae26313";
      epochTokenLocker = "0x25B06305CC4ec6AfCF3E7c0b673da1EF8ae26313";
      honeyswapFactory = "0xa818b4f111ccac7aa31d0bcc0806d64f2e0737d7";
      swaprFactory = "0x5D48C95AdfFD4B40c1AAADc4e08fc44117E02179";
      ammWhitelist = [swaprFactory,honeyswapFactory,];
      break;
  }

  // deploy Gnosis Protocol Relayer
  oracleCreator = await OracleCreator.deploy();
  
  dxRelayer = await GnosisProtocolRelayer.deploy(
    owner,
    batchExchange,
    epochTokenLocker,
    ammWhitelist,
    WETH,
    oracleCreator.address
  );

  console.log("OracleCreator deployed to:", oracleCreator.address);
  console.log("GnosisProtocolRelayer deployed to:", dxRelayer.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });