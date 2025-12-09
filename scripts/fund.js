const { ethers } = require('hardhat')

async function main() {
  const to = process.env.FUND_TO
  const amountEth = process.env.FUND_AMOUNT || '10'
  if (!to) throw new Error('FUND_TO env var required')

  const [sender] = await ethers.getSigners()
  console.log('Funding from:', sender.address)
  const tx = await sender.sendTransaction({ to, value: ethers.parseEther(amountEth) })
  console.log('Tx sent:', tx.hash)
  const rcpt = await tx.wait()
  console.log(`Funded ${amountEth} ETH to ${to}. Block:`, rcpt.blockNumber)
}

main().catch((e) => { console.error(e); process.exit(1) })


