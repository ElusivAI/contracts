/* eslint-disable no-console */
const chainToFaucets = {
  sepolia: [
    'https://faucet.polygon.technology/ethereum/sepolia',
    'https://sepoliafaucet.com/',
    'https://www.alchemy.com/faucets/ethereum-sepolia'
  ],
  baseSepolia: [
    'https://www.alchemy.com/faucets/base-sepolia'
  ],
  optimismSepolia: [
    'https://www.alchemy.com/faucets/optimism-sepolia'
  ]
}

function main() {
  const chain = (process.argv[2] || 'sepolia').trim()
  const faucets = chainToFaucets[chain]
  if (!faucets) {
    console.log(`No faucet list known for '${chain}'. Try one of: ${Object.keys(chainToFaucets).join(', ')}`)
    process.exit(0)
  }
  console.log(`Faucets for ${chain}:`)
  faucets.forEach((url) => console.log('-', url))
}

main()


