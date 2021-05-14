pragma solidity =0.6.6;
pragma experimental ABIEncoderV2;

import './libraries/TransferHelper.sol';
import './libraries/SafeMath.sol';
import './libraries/DXswapLibrary.sol';
import './interfaces/IDXswapFactory.sol';
import './interfaces/IERC20.sol';
import './interfaces/IWETH.sol';
import './interfaces/IBatchExchange.sol';
import './interfaces/IEpochTokenLocker.sol';
import './OracleCreator.sol';

contract GnosisProtocolRelayer {
    using SafeMath for uint256;

    event NewOrder(
        uint256 indexed _orderIndex
    );

    event PlacedTrade(
        uint256 indexed _orderIndex,
        uint256 _gpOrderID,
        uint16 buyToken,
        uint16 sellToken,
        uint32 validUntil,
        uint128 expectedAmountMin,
        uint128 tokenInAmount
    );

    event PlacedExactTrade(
        uint16 _gpOrderID,
        uint16 buyToken,
        uint16 sellToken,
        uint32 validFrom,
        uint32 validUntil,
        uint128 tokenOutAmount,
        uint128 tokenInAmount
    );

    event WithdrawnExpiredOrder(
        uint256 indexed _orderIndex
    );

    struct Order {
        address tokenIn;
        address tokenOut;
        uint128 tokenInAmount;
        uint128 minTokenOutAmount;
        uint256 priceTolerance;
        uint256 minReserve;
        address oraclePair;
        uint256 startDate;
        uint256 deadline;
        uint256 oracleId;
        uint256 gpOrderId;
        address factory;
        bool executed;
    }

    uint256 public immutable GAS_ORACLE_UPDATE = 168364;
    uint256 public immutable PARTS_PER_MILLION = 1000000;
    uint256 public immutable BOUNTY = 0.01 ether;
    uint256 public immutable ORACLE_WINDOW_TIME = 120; // 2 Minutes
    uint32 public immutable BATCH_TIME;
    uint32 public immutable UINT32_MAX_VALUE = 2**32 - 1;
    uint128 public immutable UINT128_MAX_VALUE = 2**128 - 1;

    address public immutable batchExchange;
    address public immutable epochTokenLocker;
    address payable public owner;
    address public immutable WETH;

    OracleCreator public oracleCreator;
    uint256 public orderCount;
    mapping(uint256 => Order) public orders;
    mapping(address => bool) public exchangeFactoryWhitelist;

    constructor(
        address payable _owner,
        address _batchExchange,
        address _epochTokenLocker,
        address[] memory _factoryWhitelist,
        address _WETH,
        OracleCreator _oracleCreater
    ) public {
        require(_factoryWhitelist.length > 0, 'GnosisProtocolRelayer: MISSING_FACTORY_WHITELIST');
        batchExchange = _batchExchange;
        epochTokenLocker = _epochTokenLocker;
        oracleCreator = _oracleCreater;
        owner = _owner;
        WETH = _WETH;
        BATCH_TIME = IEpochTokenLocker(_epochTokenLocker).BATCH_TIME();

        for (uint i=0; i < _factoryWhitelist.length; i++) {
            exchangeFactoryWhitelist[_factoryWhitelist[i]] = true;
        }
    }

    function orderTrade(
        address tokenIn,
        address tokenOut,
        uint128 tokenInAmount,
        uint128 minTokenOutAmount,
        uint256 priceTolerance,
        uint256 minReserve,
        uint256 startDate,
        uint256 deadline,
        address factory
    ) external payable returns (uint256 orderIndex) {
        require(exchangeFactoryWhitelist[factory], 'GnosisProtocolRelayer: INVALID_FACTORY');
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
        require(tokenIn != tokenOut, 'GnosisProtocolRelayer: INVALID_PAIR');
        require(tokenInAmount > 0 && minTokenOutAmount > 0, 'GnosisProtocolRelayer: INVALID_TOKEN_AMOUNT');
        require(priceTolerance <= PARTS_PER_MILLION, 'GnosisProtocolRelayer: INVALID_TOLERANCE');
        require(deadline <= UINT32_MAX_VALUE, 'GnosisProtocolRelayer: INVALID_DEADLINE');
        require(block.timestamp <= deadline, 'GnosisProtocolRelayer: DEADLINE_REACHED');
        if (tokenIn == address(0)) {
            require(address(this).balance >= tokenInAmount, 'GnosisProtocolRelayer: INSUFFICIENT_ETH');
            tokenIn = WETH;
            IWETH(WETH).deposit{value: tokenInAmount}();
        } else if (tokenOut == address(0)) {
            tokenOut = WETH;
        }
        require(IERC20(tokenIn).balanceOf(address(this)) >= tokenInAmount, 'GnosisProtocolRelayer: INSUFFIENT_TOKEN_IN');

        address pair = _pair(tokenIn, tokenOut, factory);
        require(pair != address(0), 'GnosisProtocolRelayer: UNKOWN_PAIR');
        orderIndex = _OrderIndex();
        orders[orderIndex] = Order({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            tokenInAmount: tokenInAmount,
            minTokenOutAmount: minTokenOutAmount,
            priceTolerance: priceTolerance,
            minReserve: minReserve,
            oraclePair: pair,
            startDate: startDate,
            deadline: deadline,
            oracleId: 0,
            gpOrderId: 0,
            factory: factory,
            executed: false
        });

        /* Create an oracle to calculate average price */
        orders[orderIndex].oracleId = oracleCreator.createOracle(ORACLE_WINDOW_TIME, pair);
        emit NewOrder(orderIndex);
    }

    function placeTrade(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(orderIndex < orderCount, 'GnosisProtocolRelayer: INVALID_ORDER');
        require(!order.executed, 'GnosisProtocolRelayer: ORDER_EXECUTED');
        require(oracleCreator.isOracleFinalized(order.oracleId) , 'GnosisProtocolRelayer: OBSERVATION_RUNNING');
        require(block.timestamp <= order.deadline, 'GnosisProtocolRelayer: DEADLINE_REACHED');
        require(block.timestamp > order.startDate , 'GnosisProtocolRelayer: FUTURE_STARTDATE');

        order.executed = true;
        /* Approve token on Gnosis Protocol */
        TransferHelper.safeApprove(order.tokenIn, epochTokenLocker, order.tokenInAmount);

        /* Deposit token in Gnosis Protocol */
        IEpochTokenLocker(epochTokenLocker).deposit(order.tokenIn, order.tokenInAmount);

        /* Lookup TokenIds in Gnosis Protocol */
        uint16 sellToken = IBatchExchange(batchExchange).tokenAddressToIdMap(order.tokenIn);
        uint16 buyToken = IBatchExchange(batchExchange).tokenAddressToIdMap(order.tokenOut);
        
        uint256 expectedAmount = oracleCreator.consult(
          order.oracleId,
          order.tokenIn == address(0) ? WETH : order.tokenIn,
          order.tokenInAmount 
        );

        uint256 expectedAmountMin = expectedAmount.sub(expectedAmount.mul(order.priceTolerance) / PARTS_PER_MILLION);
        
        require(expectedAmountMin >= order.minTokenOutAmount, 'GnosisProtocolRelayer: INVALID_PRICE_RANGE');
        require(expectedAmountMin <= UINT128_MAX_VALUE,'GnosisProtocolRelayer: AMOUNT_OUT_OF_RANGE');
       
        /* Calculate batch Deadline (5 Minutes window) */
        uint32 validUntil = uint32(order.deadline/BATCH_TIME);
        uint256 gpOrderId = IBatchExchange(batchExchange).placeOrder(buyToken, sellToken, validUntil, uint128(expectedAmountMin), order.tokenInAmount);
        order.gpOrderId = gpOrderId;
        emit PlacedTrade(orderIndex, gpOrderId, buyToken, sellToken, validUntil, uint128(expectedAmountMin), order.tokenInAmount);
    }

    function placeExactTrade(
        address tokenIn,
        address tokenOut,
        uint128 tokenInAmount,
        uint128 tokenOutAmount,
        uint256 startDate,
        uint256 deadline
    ) external {
        require(startDate < deadline, 'GnosisProtocolRelayer: INVALID_STARTDATE');
        require(block.timestamp <= deadline, 'GnosisProtocolRelayer: DEADLINE_REACHED');
        require(deadline <= UINT32_MAX_VALUE, 'GnosisProtocolRelayer: INVALID_DEADLINE');
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
        require(tokenIn != tokenOut, 'GnosisProtocolRelayer: INVALID_PAIR');
        require(tokenInAmount > 0 && tokenOutAmount > 0, 'GnosisProtocolRelayer: INVALID_TOKEN_AMOUNT');

        if (tokenIn == address(0)) {
            require(address(this).balance >= tokenInAmount, 'GnosisProtocolRelayer: INSUFFICIENT_ETH');
            tokenIn = WETH;
            IWETH(WETH).deposit{value: tokenInAmount}();
        } else if (tokenOut == address(0)) {
            tokenOut = WETH;
        }

        require(IERC20(tokenIn).balanceOf(address(this)) >= tokenInAmount, 'GnosisProtocolRelayer: INSUFFIENT_TOKEN_IN');

        /* Extend startDate if needed, to make sure the order will be placed on GP */
        if(startDate <= block.timestamp){
          startDate = block.timestamp.add(ORACLE_WINDOW_TIME) < deadline ? block.timestamp.add(ORACLE_WINDOW_TIME) : startDate;
        }

        /* Approve token on Gnosis Protocol */
        TransferHelper.safeApprove(tokenIn, epochTokenLocker, tokenInAmount);

        /* Deposit token in Gnosis Protocol */
        IEpochTokenLocker(epochTokenLocker).deposit(tokenIn, tokenInAmount);

        uint16[] memory sellTokens = new uint16[](1);
        uint16[] memory buyTokens = new uint16[](1);
        uint32[] memory validFroms = new uint32[](1);
        uint32[] memory validUntils = new uint32[](1);
        uint128[] memory buyAmounts = new uint128[](1);
        uint128[] memory sellAmounts = new uint128[](1);
        
         /* Lookup TokenIds in Gnosis Protocol */
        sellTokens[0] = IBatchExchange(batchExchange).tokenAddressToIdMap(tokenIn);
        buyTokens[0] = IBatchExchange(batchExchange).tokenAddressToIdMap(tokenOut);
        validFroms[0] = uint32(startDate/BATCH_TIME);
        validUntils[0] = uint32(deadline/BATCH_TIME);
        buyAmounts[0] = tokenOutAmount;
        sellAmounts[0] = tokenInAmount;

        uint16[] memory gpOrderId = IBatchExchange(batchExchange).placeValidFromOrders(buyTokens, sellTokens, validFroms, validUntils, buyAmounts, sellAmounts);
        emit PlacedExactTrade(gpOrderId[0], buyTokens[0], sellTokens[0], validFroms[0], validUntils[0], buyAmounts[0], sellAmounts[0]);
    }

    function cancelOrder(uint16 gpOrderId) external {
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');

        uint16[] memory orderArray = new uint16[](1);
        orderArray[0] = uint16(gpOrderId);
        IBatchExchange(batchExchange).cancelOrders(orderArray);
    }

    // Updates a price oracle and sends a bounty to msg.sender
    function updateOracle(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(orderIndex < orderCount, 'GnosisProtocolRelayer: INVALID_ORDER');
        require(block.timestamp <= order.deadline, 'GnosisProtocolRelayer: DEADLINE_REACHED');
        require(!oracleCreator.isOracleFinalized(order.oracleId) , 'GnosisProtocolRelayer: OBSERVATION_ENDED');
        require(block.timestamp > order.startDate, 'GnosisProtocolRelayer: FUTURE_STARTDATE');
        uint256 amountBounty = GAS_ORACLE_UPDATE.mul(tx.gasprice).add(BOUNTY);
        (uint reserve0, uint reserve1,) = IDXswapPair(order.oraclePair).getReserves();
        address token0 = IDXswapPair(order.oraclePair).token0();
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
        if(address(this).balance >= amountBounty){
            TransferHelper.safeTransferETH(msg.sender, amountBounty);
        }
    }

    function withdrawExpiredOrder(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(orderIndex < orderCount, 'GnosisProtocolRelayer: INVALID_ORDER');
        require(block.timestamp > order.deadline, 'GnosisProtocolRelayer: DEADLINE_NOT_REACHED');
        require(!order.executed, 'GnosisProtocolRelayer: ORDER_EXECUTED');

        if (order.tokenIn == WETH) {
            IWETH(WETH).withdraw(order.tokenInAmount);
            TransferHelper.safeTransferETH(owner, order.tokenInAmount);
        } else {
            TransferHelper.safeTransfer(order.tokenIn, owner, order.tokenInAmount);
        }

        order.executed = true;
        emit WithdrawnExpiredOrder(orderIndex);
    }

    // Requests a token withdraw on GP
    function requestWithdraw(address token, uint256 amount) public{
      require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
      IEpochTokenLocker(epochTokenLocker).requestWithdraw(token,amount);
    }

    // Releases tokens from Gnosis Protocol
    function withdrawToken(address token) public {
      require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
      IEpochTokenLocker(epochTokenLocker).withdraw(address(this), token);
      if (token == WETH) {
          uint balance = IWETH(WETH).balanceOf(address(this));
          IWETH(WETH).withdraw(balance);
          ETHWithdraw(balance);
      } else {
          uint balance = IERC20(token).balanceOf(address(this));
          ERC20Withdraw(token, balance);
      }
    }

    // Internal function to return the pair address on a given factory
    function _pair(address tokenA, address tokenB, address factory) internal view returns (address pair) {
      require(exchangeFactoryWhitelist[factory], 'GnosisProtocolRelayer: INVALID_FACTORY');
      pair = IDXswapFactory(factory).getPair(tokenA, tokenB);
    }

    // Returns an OrderIndex that is used to reference liquidity orders
    function _OrderIndex() internal returns(uint256 orderIndex){
        orderIndex = orderCount;
        orderCount++;
    }

    function changeOwner(address payable _newOwner) public{
      require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
      owner = _newOwner;
    }
    
    // Allows the owner to withdraw any ERC20 from the relayer
    function ERC20Withdraw(address token, uint256 amount) public {
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
        TransferHelper.safeTransfer(token, owner, amount);
    }

    // Allows the owner to withdraw any ETH amount from the relayer
    function ETHWithdraw(uint256 amount) public {
        require(msg.sender == owner, 'GnosisProtocolRelayer: CALLER_NOT_OWNER');
        TransferHelper.safeTransferETH(owner, amount);
    }

    // Returns the data of one specific order
    function GetOrderDetails(uint256 orderIndex) external view returns (Order memory) {
      return orders[orderIndex];
    }

    receive() external payable {}
}