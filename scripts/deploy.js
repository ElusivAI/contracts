const { ethers } = require('hardhat')

function getNftConfig() {
  const maxSupplyEnv = process.env.NFT_MAX_SUPPLY || '1000'
  const mintingEnabledEnv = process.env.NFT_MINTING_ENABLED || 'false'
  const mintPriceEnv = process.env.NFT_MINT_PRICE_WEI || ethers.parseEther('0.1').toString()
  const maxSupply = BigInt(maxSupplyEnv)
  const mintingEnabled = mintingEnabledEnv === 'true'
  const mintPrice = BigInt(mintPriceEnv)
  const treasury = process.env.NFT_TREASURY || null
  return { maxSupply, mintingEnabled, mintPrice, treasury }
}

function getResearchConfig() {
  const costTokens = process.env.RESEARCH_COST_TOKENS || '10'
  const maxQueryLenEnv = process.env.RESEARCH_MAX_QUERY_BYTES || `${512}`
  return { requestCost: ethers.parseUnits(costTokens, 18), maxQueryLength: Number(maxQueryLenEnv) || 512 }
}

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying with:', deployer.address)

  const Token = await ethers.getContractFactory('ElusivToken')
  const tokenTreasury = process.env.TOKEN_TREASURY || deployer.address
  const elusivToken = await Token.deploy(tokenTreasury)
  await elusivToken.waitForDeployment()
  console.log('ElusivToken:', await elusivToken.getAddress())

  const Pass = await ethers.getContractFactory('ElusivAccessPass')
  const nftConfig = getNftConfig()
  const passTreasury = nftConfig.treasury || deployer.address
  const pass = await Pass.deploy(nftConfig.maxSupply, nftConfig.mintingEnabled, nftConfig.mintPrice, passTreasury)
  await pass.waitForDeployment()
  console.log('ElusivAccessPass:', await pass.getAddress())

  const researchConfig = getResearchConfig()
  const Desk = await ethers.getContractFactory('ElusivResearchDesk')
  const desk = await Desk.deploy(await elusivToken.getAddress(), researchConfig.requestCost, researchConfig.maxQueryLength)
  await desk.waitForDeployment()
  console.log('ElusivResearchDesk:', await desk.getAddress())
}

main().catch((e) => { console.error(e); process.exit(1); })
