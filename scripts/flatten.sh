mkdir contracts/.flattened
npx truffle-flattener contracts/GnosisProtocolRelayer.sol > contracts/.flattened/GnosisProtocolRelayer.sol
npx truffle-flattener contracts/OracleCreator.sol > contracts/.flattened/OracleCreator.sol