pragma solidity =0.6.6;
pragma experimental ABIEncoderV2;

import './OracleCreator.sol';
import './interfaces/IDXswapFactory.sol';
import './libraries/TransferHelper.sol';
import './interfaces/IERC20.sol';
import './interfaces/IWETH.sol';
import './interfaces/IBatchExchange.sol';
import './interfaces/IEpochTokenLocker.sol';
import './libraries/SafeMath.sol';
import './libraries/DXswapLibrary.sol';

contract GnosisProtocolRelayer {
    using SafeMath for uint256;

    event NewOrder(
        uint256 indexed _orderIndex
    );

    event PlacedTrade(
        uint256 indexed _orderIndex,
        uint256 _GPorderID
    );

    event WithdrawnExpiredOrder(
        uint256 indexed _orderIndex
    );

    struct Order {
        address tokenIn;
        address tokenOut;
        uint128 tokenInAmount;
        uint128 tokenOutAmount;
        uint256 priceTolerance;
        uint256 minReserve;
        address oraclePair;
        uint256 deadline;
        uint256 oracleId;
        address factory;
        bool executed;
    }

    uint256 public immutable GAS_ORACLE_UPDATE = 168364;
    uint256 public immutable PARTS_PER_MILLION = 1000000;
    uint256 public immutable BOUNTY = 0.01 ether; // To be decided
    uint256 public oracleWindowTime = 240; // 4 Minutes
    uint32 public BATCH_TIME;

    address public batchExchange;
    address public epochTokenLocker;
    address payable public immutable owner;
    address public immutable dxSwapFactory;
    address public immutable uniswapFactory;
    address public immutable WETH;

    OracleCreator oracleCreator;
    uint256 public orderCount;
    mapping(uint256 => Order) orders;

    constructor(
        address payable _owner,
        address _batchExchange,
        address _epochTokenLocker,
        address _dxSwapFactory,
        address _uniswapFactory,
        address _WETH,
        OracleCreator _oracleCreater
    ) public {
        batchExchange = _batchExchange;
        epochTokenLocker = _epochTokenLocker;
        dxSwapFactory = _dxSwapFactory;
        uniswapFactory = _uniswapFactory;
        oracleCreator = _oracleCreater;
        owner = _owner;
        WETH = _WETH;
        BATCH_TIME = IEpochTokenLocker(epochTokenLocker).BATCH_TIME();
    }

    function orderTrade(
        address tokenIn,
        address tokenOut,
        uint128 tokenInAmount,
        uint128 tokenOutAmount,
        uint256 priceTolerance,
        uint256 minReserve,
        uint256 deadline,
        address factory
    ) external payable returns (uint256 orderIndex) {
        require(factory == dxSwapFactory || factory == uniswapFactory, 'GnosisProtocolRelayer: INVALID_FACTORY');
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
        require(tokenIn != tokenOut, 'GnosisProtocolRelayer: INVALID_PAIR');
        require(tokenInAmount > 0 && tokenOutAmount > 0, 'GnosisProtocolRelayer: INVALID_TOKEN_AMOUNT');
        require(priceTolerance <= PARTS_PER_MILLION, 'GnosisProtocolRelayer: INVALID_TOLERANCE');
        require(block.timestamp <= deadline, 'GnosisProtocolRelayer: DEADLINE_REACHED');
        
        if (tokenIn == address(0)) {
            tokenIn = WETH;
            IWETH(WETH).deposit{value: tokenInAmount}();
        } else if (tokenOut == address(0)) {
            tokenOut = WETH;
        }
        require(IERC20(tokenIn).balanceOf(address(this)) >= tokenInAmount, 'GnosisProtocolRelayer: INSUFFIENT_TOKEN_IN');

        address pair = _pair(tokenIn, tokenOut, factory);
        orderIndex = _OrderIndex();
        orders[orderIndex] = Order({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            tokenInAmount: tokenInAmount,
            tokenOutAmount: tokenOutAmount,
            priceTolerance: priceTolerance,
            minReserve: minReserve,
            oraclePair: pair,
            deadline: deadline,
            oracleId: 0,
            factory: factory,
            executed: false
        });

        /* Create an oracle to calculate average price */
        orders[orderIndex].oracleId = oracleCreator.createOracle(oracleWindowTime, pair);
        emit NewOrder(orderIndex);
    }

    function placeTrade(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(orderIndex <= orderCount, 'GnosisProtocolRelayer: INVALID_ORDER');
        require(!order.executed, 'GnosisProtocolRelayer: ORDER_EXECUTED');
        require(oracleCreator.isOracleFinalized(order.oracleId) , 'GnosisProtocolRelayer: OBSERVATION_RUNNING');
        require(block.timestamp <= order.deadline, 'GnosisProtocolRelayer: DEADLINE_REACHED');

        /* Approve token on Gnosis Protocol */
        TransferHelper.safeApprove(order.tokenIn, batchExchange, order.tokenInAmount);

        /* Deposit token in Gnosis Protocol */
        IEpochTokenLocker(epochTokenLocker).deposit(order.tokenIn, order.tokenInAmount);

        uint16 sellToken = IBatchExchange(batchExchange).tokenAddressToIdMap(order.tokenIn);
        uint16 buyToken = IBatchExchange(batchExchange).tokenAddressToIdMap(order.tokenOut);
        
        uint256 expectedAmount = oracleCreator.consult(
          order.oracleId,
          order.tokenIn == address(0) ? WETH : order.tokenIn,
          order.tokenInAmount 
        );

        /* Calculate batch Deadline (5 Minutes window) */
        uint256 expectedAmountMin = expectedAmount.sub(expectedAmount.mul(order.priceTolerance) / PARTS_PER_MILLION);
        uint32 currentBatch = IEpochTokenLocker(batchExchange).getCurrentBatchId();
        uint32 batchDeadline = uint32(order.deadline.sub(block.timestamp/BATCH_TIME));
        uint32 validUntil = currentBatch+batchDeadline;
       
        order.executed = true;
        uint256 GPorderId = IBatchExchange(batchExchange).placeOrder(buyToken, sellToken, validUntil, uint128(expectedAmountMin), order.tokenInAmount);
        emit PlacedTrade(orderIndex, GPorderId);
    }

    // Updates a price oracle and sends a bounty to msg.sender
    function updateOracle(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(block.timestamp <= order.deadline, 'GnosisProtocolRelayer: DEADLINE_REACHED');
        require(!oracleCreator.isOracleFinalized(order.oracleId) , 'GnosisProtocolRelayer: OBSERVATION_ENDED');
        uint256 amountBounty = GAS_ORACLE_UPDATE.mul(tx.gasprice).add(BOUNTY);
        require(address(this).balance >= amountBounty, 'GnosisProtocolRelayer: INSUFFICIENT_BALANCE');
        (uint reserve0, uint reserve1,) = IDXswapPair(order.oraclePair).getReserves();
        address token0 = IDXswapPair(order.oraclePair).token0();
        address token1 = IDXswapPair(order.oraclePair).token1();
        address tokenIn = order.tokenIn == address(0) ? WETH : order.tokenIn;

        // Makes sure the reserve of TokenIn is higher then minReserve
        if(tokenIn == token0){
            require(
              reserve0 >= order.minReserve,
              'GnosisProtocolRelayer: RESERVE_TO_LOW'
            );
        } else {
            require(
              reserve1 >= order.minReserve,
              'GnosisProtocolRelayer: RESERVE_TO_LOW'
            );
        }
        
        oracleCreator.update(order.oracleId);
        TransferHelper.safeTransferETH(msg.sender, amountBounty);
    }

    function withdrawExpiredOrder(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
        require(block.timestamp > order.deadline, 'GnosisProtocolRelayer: DEADLINE_NOT_REACHED');
        require(order.executed == false, 'GnosisProtocolRelayer: ORDER_EXECUTED');

        IEpochTokenLocker(epochTokenLocker).withdraw(address(this), order.tokenIn);
        if (order.tokenIn == address(0)) {
            IWETH(WETH).withdraw(order.tokenInAmount);
            TransferHelper.safeTransferETH(owner, order.tokenInAmount);
        } else {
            TransferHelper.safeTransfer(order.tokenIn, owner, order.tokenInAmount);
        }

        order.executed = true;
        emit WithdrawnExpiredOrder(orderIndex);
    }

    // Releases tokens from Gnosis Protocol
    function withdrawToken(address token) external {
      IEpochTokenLocker(epochTokenLocker).withdraw(address(this), token);
    }

    // Internal function to return the correct pair address on either DXswap or Uniswap
    function _pair(address tokenA, address tokenB, address factory) internal view returns (address pair) {
      require(factory == dxSwapFactory || factory == uniswapFactory, 'GnosisProtocolRelayer: INVALID_FACTORY');
      pair = IDXswapFactory(factory).getPair(tokenA, tokenB);
    }

    // Returns an OrderIndex that is used to reference liquidity orders
    function _OrderIndex() internal returns(uint256 orderIndex){
        orderIndex = orderCount;
        orderCount++;
    }
    
    // Allows the owner to withdraw any ERC20 from the relayer
    function ERC20Withdraw(address token, uint256 amount) external {
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
        TransferHelper.safeTransfer(token, owner, amount);
    }

    // Allows the owner to withdraw any ETH amount from the relayer
    function ETHWithdraw(uint256 amount) external {
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
        TransferHelper.safeTransferETH(owner, amount);
    }

    // Returns the data of one specific order
    function GetOrderDetails(uint256 orderIndex) external view returns (Order memory) {
      return orders[orderIndex];
    }

    receive() external payable {}
}