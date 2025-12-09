require('@nomicfoundation/hardhat-toolbox');
require('solidity-coverage');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { HARDHAT_SEPOLIA_RPC_URL, HARDHAT_PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

const networks = {
  hardhat: {},
  localhost: {
    url: 'http://localhost:8545',
    chainId: 31337
  }
};

if (HARDHAT_SEPOLIA_RPC_URL && HARDHAT_PRIVATE_KEY) {
  networks.sepolia = {
    url: HARDHAT_SEPOLIA_RPC_URL,
    accounts: [HARDHAT_PRIVATE_KEY]
  };
}

module.exports = {
  solidity: '0.8.24',
  networks,
  etherscan: ETHERSCAN_API_KEY ? { apiKey: ETHERSCAN_API_KEY } : undefined
};
