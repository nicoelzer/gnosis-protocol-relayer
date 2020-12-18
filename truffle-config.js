module.exports = {
  // Configure your compilers
  compilers: {
    solc: {
      version: "0.6.6", 
      settings: {
        optimizer: {
          enabled: false,
          runs: 200
      }
    }
  }
  }
};