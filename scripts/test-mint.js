const { ethers } = require('hardhat')

async function main() {
  const passAddress = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'
  const testWallet = '0x03b056dBc75fb233eEf0a01319bA5F9EaD342f4e'
  
  const pass = await ethers.getContractAt('ElusivAccessPass', passAddress)
  const [signer] = await ethers.getSigners()
  
  console.log('Testing mint simulation...')
  console.log('Signer:', signer.address)
  console.log('Test wallet:', testWallet)
  
  const mintPrice = await pass.mintPrice()
  console.log('Mint price:', ethers.formatEther(mintPrice), 'ETH')
  
  // Check if signer has enough balance
  const balance = await ethers.provider.getBalance(signer.address)
  console.log('Signer balance:', ethers.formatEther(balance), 'ETH')
  
  try {
    const result = await pass.connect(signer).publicMint.staticCall(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      { value: mintPrice }
    )
    console.log('✅ Simulation successful!')
    console.log('Result:', result)
  } catch (e) {
    console.log('❌ Simulation failed')
    console.log('Error:', e.message)
    if (e.reason) console.log('Reason:', e.reason)
    if (e.data) console.log('Data:', JSON.stringify(e.data, null, 2))
    
    // Try to extract more details
    if (e.error) {
      console.log('Error details:', e.error)
    }
  }
}

main().catch(console.error)
