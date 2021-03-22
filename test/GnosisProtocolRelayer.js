const { contract, ethers } = require("hardhat");
const { expect } = require("chai");
const { AddressZero } = require("@ethersproject/constants");
const { expandTo18Decimals, mineBlock } = require("./shared/utilities");
const DXswapFactory = require("dxswap-core/build/DXswapFactory.json");
const DXswapRouter = require("dxswap-periphery/build/DXswapRouter.json");
const IDXswapPair = require("dxswap-core/build/IDXswapPair.json");

let tokenA,
  tokenB,
  WETH,
  WETHPartner,
  dxswapFactory,
  dxswapRouter,
  uniFactory,
  batchExchange,
  epochTokenLocker,
  dxRelayer,
  oracleCreator,
  feeToken,
  wallet,
  otherWallet;

const UINT32_MAX = Math.pow(2,32) - 1;

contract("GnosisProtcolRelayer", () => {
  beforeEach("deploy contracts", async function () {
    [wallet, otherWallet] = await ethers.getSigners();
  });

  describe("GnosisProtcolRelayer", function () {
    const defaultTolerance = 10000;
    const defaultMinReserve = expandTo18Decimals(5);

    beforeEach("deploy contracts", async function () {
      WETH9 = await ethers.getContractFactory("WETH9");
      ERC20 = await ethers.getContractFactory("ERC20");
      const OracleCreator = await ethers.getContractFactory("OracleCreator");
      const EpochTokenLocker = await ethers.getContractFactory(
        "EpochTokenLocker"
      );
      const GnosisProtocolRelayer = await ethers.getContractFactory(
        "GnosisProtocolRelayer"
      );
      const IdToAddressBiMap = await ethers.getContractFactory(
        "IdToAddressBiMap"
      );
      const IterableAppendOnlySet = await ethers.getContractFactory(
        "IterableAppendOnlySet"
      );
      const idToAddressBiMap = await IdToAddressBiMap.deploy();
      const iterableAppendOnlySet = await IterableAppendOnlySet.deploy();
      const BatchExchange = await ethers.getContractFactory("BatchExchange", {
        libraries: {
          IdToAddressBiMap: idToAddressBiMap.address,
          IterableAppendOnlySet: iterableAppendOnlySet.address,
        },
      });

      const factory = new ethers.ContractFactory(
        DXswapFactory.abi,
        DXswapFactory.bytecode,
        wallet
      );

      const router = new ethers.ContractFactory(
        DXswapRouter.abi,
        DXswapRouter.bytecode,
        wallet
      );

      // deploy tokens
      WETH = await WETH9.deploy();
      tokenA = await ERC20.deploy(expandTo18Decimals(10000));
      tokenB = await ERC20.deploy(expandTo18Decimals(10000));
      feeToken = await ERC20.deploy(expandTo18Decimals(10000));
      WETHPartner = await ERC20.deploy(expandTo18Decimals(10000));

      // deploy batchExchange
      epochTokenLocker = await EpochTokenLocker.deploy();
      batchExchange = await BatchExchange.deploy(feeToken.address);

      // deploy factories
      dxswapFactory = await factory.deploy(wallet.address);
      uniFactory = await factory.deploy(wallet.address);

      // deploy DXswapRouter
      dxswapRouter = await router.deploy(dxswapFactory.address, WETH.address);

      // deploy Gnosis Protocol Relayer
      oracleCreator = await OracleCreator.deploy();
      dxRelayer = await GnosisProtocolRelayer.deploy(
        wallet.address,
        batchExchange.address,
        epochTokenLocker.address,
        [dxswapFactory.address],
        WETH.address,
        oracleCreator.address
      );
    });

    // 1/1/2021 @ 12:00 am UTC
    // cannot be 0 because that instructs ganache to set it to current timestamp
    // cannot be 86400 because then timestamp 0 is a valid historical observation
    const startTime = 1909459200;
    const defaultDeadline = startTime + 86400; // 24 hours
    beforeEach(`set start time to ${startTime}`, () => mineBlock(startTime));

    describe("Initialization", function () {
      it("cannot deploy Relayer without Factory whitelist", async () => {
        const GnosisProtocolRelayer = await ethers.getContractFactory(
          "GnosisProtocolRelayer"
        );
        await expect(
          GnosisProtocolRelayer.deploy(
            wallet.address,
            batchExchange.address,
            epochTokenLocker.address,
            [],
            WETH.address,
            oracleCreator.address
          )
        ).to.be.revertedWith(
          "GnosisProtocolRelayer: MISSING_FACTORY_WHITELIST"
        );
      });
    });
    describe("Creating orders", function () {
      it("cannot place order with invalid factory", async function () {
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            tokenB.address,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline,
            uniFactory.address
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: INVALID_FACTORY");
      });

      it("cannot place order from other address then owner", async function () {
        await expect(
          dxRelayer
            .connect(otherWallet)
            .orderTrade(
              tokenA.address,
              tokenB.address,
              expandTo18Decimals(10),
              expandTo18Decimals(10),
              defaultTolerance,
              defaultMinReserve,
              startTime,
              defaultDeadline,
              dxswapFactory.address
            )
        ).to.be.revertedWith("GnosisProtocolRelayer: CALLER_NOT_OWNER");
      });

      it("cannot place order with same tokens", async function () {
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            tokenA.address,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline,
            dxswapFactory.address
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: INVALID_PAIR");
      });

      it("cannot place order with zero amount", async function () {
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            tokenB.address,
            0,
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline,
            dxswapFactory.address
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: INVALID_TOKEN_AMOUNT");
      });

      it("cannot place order with invalid priceTolerance", async function () {
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            tokenB.address,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            100000000,
            defaultMinReserve,
            startTime,
            defaultDeadline,
            dxswapFactory.address
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: INVALID_TOLERANCE");
      });

      it("cannot place order with deadline in past", async function () {
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            tokenB.address,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            startTime - 100,
            dxswapFactory.address
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: DEADLINE_REACHED");
      });

      it("cannot place order with deadline greater uint32 max value", async function () {
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            tokenB.address,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            UINT32_MAX + 1,
            dxswapFactory.address
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: INVALID_DEADLINE");
      });

      it("cannot place order with insufficient ETH value", async function () {
        await expect(
          dxRelayer.orderTrade(
            AddressZero,
            tokenB.address,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline,
            dxswapFactory.address,
            {
              value: expandTo18Decimals(5),
            }
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: INSUFFICIENT_ETH");
      });

      it("cannot place order with insufficient token value", async function () {
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(5));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(5)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            tokenB.address,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline,
            dxswapFactory.address
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: INSUFFIENT_TOKEN_IN");
      });

      it("does not accept trade with unkown pair", async function () {
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            tokenB.address,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline,
            dxswapFactory.address
          )
        ).to.be.revertedWith("GnosisProtocolRelayer: UNKOWN_PAIR");
      });

      it("creates a new order with token to token trade", async function () {
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await dxswapFactory.createPair(tokenA.address, tokenB.address);
        await dxRelayer.orderTrade(
          tokenA.address,
          tokenB.address,
          expandTo18Decimals(10),
          expandTo18Decimals(10),
          defaultTolerance,
          defaultMinReserve,
          startTime,
          defaultDeadline,
          dxswapFactory.address
        );
      });

      it("creates a new order with ETH to token trade", async function () {
        await dxswapFactory.createPair(WETH.address, tokenB.address);
        await dxRelayer.orderTrade(
          AddressZero,
          tokenB.address,
          expandTo18Decimals(10),
          expandTo18Decimals(10),
          defaultTolerance,
          defaultMinReserve,
          startTime,
          defaultDeadline,
          dxswapFactory.address,
          {
            value: expandTo18Decimals(10),
          }
        );
      });

      it("creates a new order with token to ETH trade", async function () {
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        await dxRelayer.orderTrade(
          tokenA.address,
          AddressZero,
          expandTo18Decimals(10),
          expandTo18Decimals(10),
          defaultTolerance,
          defaultMinReserve,
          startTime,
          defaultDeadline,
          dxswapFactory.address
        );
      });
    });

    describe("Updating the Oracle", function () {
      it("updates the oracle", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        const pair = await new ethers.Contract(
          pairAddress,
          IDXswapPair.abi,
          wallet
        );

        await tokenA.transfer(pairAddress, expandTo18Decimals(10));
        await WETH.deposit({ value: expandTo18Decimals(10) });
        await WETH.transfer(pairAddress, expandTo18Decimals(10));
        await pair.mint(wallet.address);

        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(1),
        });
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            AddressZero,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline,
            dxswapFactory.address
          )
        )
          .to.emit(dxRelayer, "NewOrder")
          .withArgs(0);

        mineBlock(startTime + 300);
        await dxRelayer.updateOracle(0);
        await expect(dxRelayer.updateOracle(0)).to.be.revertedWith(
          "OracleCreator: PERIOD_NOT_ELAPSED"
        );
        mineBlock(startTime + 600);
        await dxRelayer.updateOracle(0);
      });

      it("cannot update the oracle after observation ended", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        const pair = await new ethers.Contract(
          pairAddress,
          IDXswapPair.abi,
          wallet
        );

        await tokenA.transfer(pairAddress, expandTo18Decimals(5));
        await WETH.deposit({ value: expandTo18Decimals(5) });
        await WETH.transfer(pairAddress, expandTo18Decimals(5));
        await pair.mint(wallet.address);

        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(1),
        });
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            AddressZero,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            expandTo18Decimals(5),
            startTime,
            defaultDeadline,
            dxswapFactory.address
          )
        )
          .to.emit(dxRelayer, "NewOrder")
          .withArgs(0);

        mineBlock(startTime + 1000);
        await dxRelayer.updateOracle(0);
        await expect(dxRelayer.updateOracle(0)).to.be.revertedWith(
          "OracleCreator: PERIOD_NOT_ELAPSED"
        );
        mineBlock(startTime + 2000);
        await dxRelayer.updateOracle(0);
        await expect(dxRelayer.updateOracle(0)).to.be.revertedWith(
          "GnosisProtocolRelayer: OBSERVATION_ENDED"
        );
      });

      it("returns the correct oracleDetails", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        const pair = await new ethers.Contract(
          pairAddress,
          IDXswapPair.abi,
          wallet
        );

        await tokenA.transfer(pairAddress, expandTo18Decimals(5));
        await WETH.deposit({ value: expandTo18Decimals(5) });
        await WETH.transfer(pairAddress, expandTo18Decimals(5));
        await pair.mint(wallet.address);

        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(1),
        });
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            AddressZero,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            expandTo18Decimals(5),
            startTime,
            defaultDeadline,
            dxswapFactory.address
          )
        )
          .to.emit(dxRelayer, "NewOrder")
          .withArgs(0);

        const response = await oracleCreator.getOracleDetails(0);
        let token0 =
          tokenA.address < WETH.address ? tokenA.address : WETH.address;
        let token1 =
          tokenA.address > WETH.address ? tokenA.address : WETH.address;
        expect(await response.token0).to.eq(token0);
        expect(await response.token1).to.eq(token1);
        let tokenPair = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        expect(await response.pair).to.eq(tokenPair);
      });

      it("consults token prices", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        const pair = await new ethers.Contract(
          pairAddress,
          IDXswapPair.abi,
          wallet
        );

        await tokenA.transfer(pairAddress, expandTo18Decimals(2));
        await WETH.deposit({ value: expandTo18Decimals(2) });
        await WETH.transfer(pairAddress, expandTo18Decimals(2));
        await pair.mint(wallet.address);

        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(2),
        });
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            AddressZero,
            expandTo18Decimals(10),
            expandTo18Decimals(10),
            defaultTolerance,
            expandTo18Decimals(1),
            startTime,
            defaultDeadline + 10000,
            dxswapFactory.address
          )
        )
          .to.emit(dxRelayer, "NewOrder")
          .withArgs(0);

        await mineBlock(startTime + 8900);
        await dxRelayer.updateOracle(0);
        await mineBlock(startTime + 9300);
        await dxRelayer.updateOracle(0);
        await expect(
          oracleCreator.consult(0, tokenB.address, expandTo18Decimals(1000))
        ).to.be.revertedWith("OracleCreator: INVALID_TOKEN");
        await oracleCreator.consult(
          0,
          tokenA.address,
          expandTo18Decimals(1000)
        );
        await oracleCreator.consult(0, WETH.address, expandTo18Decimals(1000));
      });
    });

    describe("Withdrawal", function () {
      it("withdraws tokens from Gnosis Protocol to the relayer", async function () {
        await dxRelayer.withdrawToken(tokenA.address);
        await dxRelayer.withdrawToken(WETH.address);
      });

      it("only allows the owner to withdraw ERC20 tokens from the relayer", async function () {
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        await expect(
          dxRelayer
            .connect(otherWallet)
            .ERC20Withdraw(tokenA.address, expandTo18Decimals(10))
        ).to.be.revertedWith("GnosisProtocolRelayer: CALLER_NOT_OWNER");
        const balanceBefore = await tokenA.balanceOf(wallet.address);
        await dxRelayer.ERC20Withdraw(tokenA.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(wallet.address)).to.eq(
          balanceBefore.add(expandTo18Decimals(10))
        );
      });

      it("only allows the owner to withdraw ETH from the relayer", async function () {
        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(10),
        });
        await expect(
          dxRelayer.connect(otherWallet).ETHWithdraw(expandTo18Decimals(10))
        ).to.be.revertedWith("GnosisProtocolRelayer: CALLER_NOT_OWNER");
        const balanceBefore = await wallet.getBalance();
        await dxRelayer.ETHWithdraw(expandTo18Decimals(10));
        expect(await wallet.getBalance()).to.be.above(balanceBefore);
      });

      it("can withdraw an expired order: ERC20 Token", async function () {
        await mineBlock(startTime);
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await dxswapFactory.createPair(tokenA.address, tokenB.address);
        await dxRelayer.orderTrade(
          tokenA.address,
          tokenB.address,
          expandTo18Decimals(10),
          expandTo18Decimals(10),
          defaultTolerance,
          defaultMinReserve,
          startTime,
          defaultDeadline,
          dxswapFactory.address
        );

        await expect(dxRelayer.withdrawExpiredOrder(0)).to.be.revertedWith(
          "GnosisProtocolRelayer: DEADLINE_NOT_REACHED"
        );

        mineBlock(defaultDeadline + 300);

        await expect(dxRelayer.withdrawExpiredOrder(0))
          .to.emit(dxRelayer, "WithdrawnExpiredOrder")
          .withArgs(0);
      });

      it("can withdraw an expired order: ETH", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        await dxRelayer.orderTrade(
          AddressZero,
          tokenA.address,
          expandTo18Decimals(1),
          expandTo18Decimals(1),
          defaultTolerance,
          defaultMinReserve,
          startTime,
          defaultDeadline + 5000,
          dxswapFactory.address,
          {
            value: expandTo18Decimals(1),
          }
        );

        await expect(dxRelayer.withdrawExpiredOrder(0)).to.be.revertedWith(
          "GnosisProtocolRelayer: DEADLINE_NOT_REACHED"
        );

        mineBlock(defaultDeadline + 6000);
        await expect(dxRelayer.withdrawExpiredOrder(0))
          .to.emit(dxRelayer, "WithdrawnExpiredOrder")
          .withArgs(0);
      });
    });

    describe("Place trade", function () {
      it("cannot place non existent order", async function () {
        await expect(dxRelayer.placeTrade(3)).to.be.revertedWith(
          "GnosisProtocolRelayer: INVALID_ORDER"
        );
      });

      it("places a trade", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        const pair = await new ethers.Contract(
          pairAddress,
          IDXswapPair.abi,
          wallet
        );

        await tokenA.transfer(pairAddress, expandTo18Decimals(5));
        await WETH.deposit({ value: expandTo18Decimals(5) });
        await WETH.transfer(pairAddress, expandTo18Decimals(5));
        await pair.mint(wallet.address);

        await batchExchange.addToken(tokenA.address);
        await batchExchange.addToken(WETH.address);

        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(1),
        });
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            AddressZero,
            expandTo18Decimals(10),
            expandTo18Decimals(1),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline + 10000,
            dxswapFactory.address
          )
        )
          .to.emit(dxRelayer, "NewOrder")
          .withArgs(0);

        mineBlock(defaultDeadline + 7000);
        await dxRelayer.updateOracle(0);
        mineBlock(defaultDeadline + 8000);
        await dxRelayer.updateOracle(0);

        await expect(dxRelayer.placeTrade(0))
          .to.emit(dxRelayer, "PlacedTrade")
      });

      it("cannot place a trade twice", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        const pair = await new ethers.Contract(
          pairAddress,
          IDXswapPair.abi,
          wallet
        );

        await tokenA.transfer(pairAddress, expandTo18Decimals(5));
        await WETH.deposit({ value: expandTo18Decimals(5) });
        await WETH.transfer(pairAddress, expandTo18Decimals(5));
        await pair.mint(wallet.address);

        await batchExchange.addToken(tokenA.address);
        await batchExchange.addToken(WETH.address);

        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(1),
        });
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            AddressZero,
            expandTo18Decimals(10),
            expandTo18Decimals(1),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline + 10000,
            dxswapFactory.address
          )
        )
          .to.emit(dxRelayer, "NewOrder")
          .withArgs(0);

        mineBlock(defaultDeadline + 7500);
        await dxRelayer.updateOracle(0);
        await expect(dxRelayer.placeTrade(0)).to.be.revertedWith(
          "GnosisProtocolRelayer: OBSERVATION_RUNNING"
        );
        mineBlock(defaultDeadline + 8500);
        await dxRelayer.updateOracle(0);

        await expect(dxRelayer.placeTrade(0))
          .to.emit(dxRelayer, "PlacedTrade")
      
        await expect(dxRelayer.placeTrade(0)).to.be.revertedWith(
          "GnosisProtocolRelayer: ORDER_EXECUTED"
        );
      });

    });

    describe("Cancel trade", function () {
      it("can only be executed for valid orders", async function () {
        await expect(dxRelayer.cancelOrder(3)).to.be.revertedWith(
          "GnosisProtocolRelayer: INVALID_ORDER"
        );
      });

      it("can only be executed by owner", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        await dxRelayer.orderTrade(
          AddressZero,
          tokenA.address,
          expandTo18Decimals(1),
          expandTo18Decimals(1),
          defaultTolerance,
          defaultMinReserve,
          startTime,
          defaultDeadline + 10000,
          dxswapFactory.address,
          {
            value: expandTo18Decimals(1),
          }
        );
        await expect(
          dxRelayer.connect(otherWallet).cancelOrder(0)
        ).to.be.revertedWith("GnosisProtocolRelayer: CALLER_NOT_OWNER");
      });

      it("can cancel an existing order", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        const pair = await new ethers.Contract(
          pairAddress,
          IDXswapPair.abi,
          wallet
        );

        await tokenA.transfer(pairAddress, expandTo18Decimals(5));
        await WETH.deposit({ value: expandTo18Decimals(5) });
        await WETH.transfer(pairAddress, expandTo18Decimals(5));
        await pair.mint(wallet.address);

        await batchExchange.addToken(tokenA.address);
        await batchExchange.addToken(WETH.address);

        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(1),
        });
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(10)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            AddressZero,
            expandTo18Decimals(10),
            expandTo18Decimals(1),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline + 10000,
            dxswapFactory.address
          )
        )
          .to.emit(dxRelayer, "NewOrder")
          .withArgs(0);

        mineBlock(defaultDeadline + 8500);
        await dxRelayer.updateOracle(0);
        mineBlock(defaultDeadline + 9500);
        await dxRelayer.updateOracle(0);

        await dxRelayer.placeTrade(0);
        await dxRelayer.cancelOrder(0);
      });

      it("returns the correct order data", async function () {
        await dxswapFactory.createPair(tokenA.address, tokenB.address);
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(10));
        await dxRelayer.orderTrade(
          tokenA.address,
          tokenB.address,
          expandTo18Decimals(10),
          expandTo18Decimals(10),
          defaultTolerance,
          defaultMinReserve,
          startTime,
          defaultDeadline + 10000,
          dxswapFactory.address,
          {
            value: expandTo18Decimals(1),
          }
        );

        const response = await dxRelayer.GetOrderDetails(0);
        expect(await response.tokenIn).to.eq(tokenA.address);
        expect(await response.tokenOut).to.eq(tokenB.address);
        expect(await response.tokenInAmount).to.eq(expandTo18Decimals(10));
        expect(await response.tokenOutAmount).to.eq(expandTo18Decimals(10));
        expect(await response.priceTolerance).to.eq(defaultTolerance);
        expect(await response.minReserve).to.eq(defaultMinReserve);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          tokenB.address
        );
        expect(await response.oraclePair).to.eq(pairAddress);
        expect(await response.deadline).to.eq(defaultDeadline + 10000);
        expect(await response.factory).to.eq(dxswapFactory.address);
        expect(await response.executed).to.eq(false);
      });

      it("cannot update oracle when deadline reached", async function () {
        await dxswapFactory.createPair(tokenA.address, WETH.address);
        const pairAddress = await dxswapFactory.getPair(
          tokenA.address,
          WETH.address
        );
        const pair = await new ethers.Contract(
          pairAddress,
          IDXswapPair.abi,
          wallet
        );

        await tokenA.transfer(pairAddress, expandTo18Decimals(5));
        await WETH.deposit({ value: expandTo18Decimals(5) });
        await WETH.transfer(pairAddress, expandTo18Decimals(5));
        await pair.mint(wallet.address);

        await batchExchange.addToken(tokenA.address);
        await batchExchange.addToken(WETH.address);

        await wallet.sendTransaction({
          to: dxRelayer.address,
          value: expandTo18Decimals(1),
        });
        await tokenA.transfer(dxRelayer.address, expandTo18Decimals(5));
        expect(await tokenA.balanceOf(dxRelayer.address)).to.eq(
          expandTo18Decimals(5)
        );
        await expect(
          dxRelayer.orderTrade(
            tokenA.address,
            AddressZero,
            expandTo18Decimals(1),
            expandTo18Decimals(1),
            defaultTolerance,
            defaultMinReserve,
            startTime,
            defaultDeadline + 9600,
            dxswapFactory.address
          )
        )
          .to.emit(dxRelayer, "NewOrder")
          .withArgs(0);

        mineBlock(defaultDeadline + 10000);
        await expect(dxRelayer.updateOracle(0)).to.be.revertedWith(
          "GnosisProtocolRelayer: DEADLINE_REACHED"
        );
      });
    });
  });
});
