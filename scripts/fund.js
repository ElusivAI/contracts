const { ethers } = require('hardhat')

async function main() {
  const to = process.env.FUND_TO
  const amountEth = process.env.FUND_AMOUNT || '10'
  const tokenAddress = process.env.TOKEN_ADDRESS
  const tokenAmount = process.env.TOKEN_AMOUNT || '10000'
  
  if (!to) throw new Error('FUND_TO env var required')

  const [sender] = await ethers.getSigners()
  console.log('Funding from:', sender.address)
  
  // Fund ETH
  const ethTx = await sender.sendTransaction({ to, value: ethers.parseEther(amountEth) })
  console.log('ETH Tx sent:', ethTx.hash)
  const ethRcpt = await ethTx.wait()
  console.log(`Funded ${amountEth} ETH to ${to}. Block:`, ethRcpt.blockNumber)
  
  // Fund ELUSIV tokens if token address is provided
  if (tokenAddress) {
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = Token.attach(tokenAddress)
    const tokenTx = await token.transfer(to, ethers.parseEther(tokenAmount))
    console.log('Token Tx sent:', tokenTx.hash)
    const tokenRcpt = await tokenTx.wait()
    console.log(`Funded ${tokenAmount} ELUSIV to ${to}. Block:`, tokenRcpt.blockNumber)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })


