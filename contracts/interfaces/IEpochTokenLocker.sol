pragma solidity >=0.5.0;

interface IEpochTokenLocker {
  function deposit(address token, uint256 amount) external;
  function withdraw(address user, address token) external;
  function getCurrentBatchId() external view returns (uint32);
  function BATCH_TIME() external view returns(uint32);
}