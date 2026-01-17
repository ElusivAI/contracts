const { ethers } = require('hardhat')

async function main() {
  const passAddress = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'
  const walletAddress = process.argv[2] || '0x03b056dBc75fb233eEf0a01319bA5F9EaD342f4e'
  
  const pass = await ethers.getContractAt('ElusivAccessPass', passAddress)
  
  // Check balance (how many this wallet has minted)
  const balance = await pass.balanceOf(walletAddress)
  const maxPerWallet = await pass.MAX_PER_WALLET()
  
  console.log('Wallet:', walletAddress)
  console.log('Balance (NFTs owned):', balance.toString())
  console.log('Max per wallet:', maxPerWallet.toString())
  console.log('Can mint?', balance < maxPerWallet ? 'Yes' : 'No - already minted max')
  
  // Try to simulate the mint
  const [signer] = await ethers.getSigners()
  const mintPrice = await pass.mintPrice()
  
  console.log('\nAttempting to simulate mint...')
  try {
    const tx = await pass.connect(signer).publicMint.staticCall(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      { value: mintPrice, from: walletAddress }
    )
    console.log('Simulation successful!')
  } catch (e) {
    console.log('Simulation failed:', e.message)
    if (e.reason) console.log('Reason:', e.reason)
    if (e.data) console.log('Data:', e.data)
  }
}

main().catch(console.error)
