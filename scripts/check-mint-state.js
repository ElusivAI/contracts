const { ethers } = require('hardhat')

async function main() {
  const passAddress = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'
  const pass = await ethers.getContractAt('ElusivAccessPass', passAddress)
  
  const mintingEnabled = await pass.mintingEnabled()
  const mintPrice = await pass.mintPrice()
  const maxSupply = await pass.maxSupply()
  const nextTokenId = await pass.nextTokenId()
  const treasury = await pass.treasury()
  
  console.log('Contract State:')
  console.log('  Minting Enabled:', mintingEnabled)
  console.log('  Mint Price:', ethers.formatEther(mintPrice), 'ETH')
  console.log('  Max Supply:', maxSupply.toString())
  console.log('  Next Token ID:', nextTokenId.toString())
  console.log('  Remaining:', (maxSupply - nextTokenId).toString())
  console.log('  Treasury:', treasury)
}

main().catch(console.error)
