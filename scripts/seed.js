const fs = require('fs')
const path = require('path')
const { ethers } = require('hardhat')

function getNftConfig(defaultTreasury) {
  const maxSupplyEnv = process.env.NFT_MAX_SUPPLY || '1000'
  const mintingEnabledEnv = process.env.NFT_MINTING_ENABLED || 'true'
  const mintPriceEnv = process.env.NFT_MINT_PRICE_WEI || ethers.parseEther('0.001').toString()
  return {
    maxSupply: BigInt(maxSupplyEnv),
    mintingEnabled: mintingEnabledEnv === 'true',
    mintPrice: BigInt(mintPriceEnv),
    treasury: process.env.NFT_TREASURY || defaultTreasury
  }
}

function getResearchConfig() {
  const costTokens = process.env.RESEARCH_COST_TOKENS || '10'
  const maxQueryLenEnv = process.env.RESEARCH_MAX_QUERY_BYTES || `${512}`
  return { requestCost: ethers.parseUnits(costTokens, 18), maxQueryLength: Number(maxQueryLenEnv) || 512 }
}

async function main() {
  const [deployer, user] = await ethers.getSigners()
  const to = process.env.SEED_TO || user.address

  const Token = await ethers.getContractFactory('ElusivToken')
  const elusivToken = await Token.deploy(deployer.address)
  await elusivToken.waitForDeployment()
  const tokenAddress = await elusivToken.getAddress()
  console.log('ElusivToken:', tokenAddress)
  await elusivToken.transfer(to, 10_000n * 10n ** 18n)
  console.log('Transferred 10,000 ELUSIV to', to)

  const nftConfig = getNftConfig(deployer.address)
  const Pass = await ethers.getContractFactory('ElusivAccessPass')
  const pass = await Pass.deploy(nftConfig.maxSupply, nftConfig.mintingEnabled, nftConfig.mintPrice, nftConfig.treasury)
  await pass.waitForDeployment()
  const passAddress = await pass.getAddress()
  console.log('ElusivAccessPass:', passAddress)
  await pass.mint(to)
  console.log('Minted 1 Elusiv Access Pass to', to)

  const researchConfig = getResearchConfig()
  const Desk = await ethers.getContractFactory('ElusivResearchDesk')
  const desk = await Desk.deploy(tokenAddress, researchConfig.requestCost, researchConfig.maxQueryLength)
  await desk.waitForDeployment()
  const deskAddress = await desk.getAddress()
  console.log('ElusivResearchDesk:', deskAddress)

  // Write addresses to frontend config
  const root = path.resolve(__dirname, '..', '..')
  const addressesPath = path.join(root, 'frontend', 'src', 'config', 'addresses.json')
  let data = {}
  if (fs.existsSync(addressesPath)) {
    try { data = JSON.parse(fs.readFileSync(addressesPath, 'utf8')) } catch {}
  }
  data['31337'] = { // localhost
    ElusivToken: tokenAddress,
    ElusivAccessPass: passAddress,
    ElusivResearchDesk: deskAddress
  }
  fs.writeFileSync(addressesPath, JSON.stringify(data, null, 2))
  console.log('Wrote localhost addresses to', addressesPath)
}

main().catch((e) => { console.error(e); process.exit(1); })
