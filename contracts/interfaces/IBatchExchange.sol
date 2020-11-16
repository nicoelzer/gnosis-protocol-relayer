pragma solidity >=0.5.0;

interface IBatchExchange {

    function tokenAddressToIdMap(address addr) external view returns (uint16);
    function tokenIdToAddressMap(uint16 id) external view returns (address);
    function hasToken(address addr) external view returns (bool);
    function placeOrder(uint16 buyToken,uint16 sellToken, uint32 validUntil,uint128 buyAmount,uint128 sellAmount) external returns (uint256);
    function cancelOrders(uint16[] calldata orderIds) external;

}