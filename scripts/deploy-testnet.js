/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')

function getNftConfig(ethers) {
  const maxSupplyEnv = process.env.NFT_MAX_SUPPLY || '1000'
  const mintingEnabledEnv = process.env.NFT_MINTING_ENABLED || 'false'
  const mintPriceEnv = process.env.NFT_MINT_PRICE_WEI || ethers.parseEther('0.1').toString()
  const maxSupply = BigInt(maxSupplyEnv)
  const mintingEnabled = mintingEnabledEnv === 'true'
  const mintPrice = BigInt(mintPriceEnv)
  return { maxSupply, mintingEnabled, mintPrice, treasury: process.env.NFT_TREASURY || null }
}

function getResearchConfig(ethers) {
  const costTokens = process.env.RESEARCH_COST_TOKENS || '10'
  const maxQueryLenEnv = process.env.RESEARCH_MAX_QUERY_BYTES || `${512}`
  return { requestCost: ethers.parseUnits(costTokens, 18), maxQueryLength: Number(maxQueryLenEnv) || 512 }
}

async function main() {
  const hre = require('hardhat')
  const { ethers, network, run } = hre

  const chainId = Number((await ethers.provider.getNetwork()).chainId)
  if (!chainId || chainId === 31337) {
    console.warn('This script is intended for testnets. Current chainId:', chainId)
  }

  const [deployer] = await ethers.getSigners()
  console.log('Deploying with:', deployer.address)
  console.log('Network:', network.name, 'chainId:', chainId)

  const Token = await ethers.getContractFactory('ElusivToken')
  const tokenTreasury = process.env.TOKEN_TREASURY || deployer.address
  const elusivToken = await Token.deploy(tokenTreasury)
  await elusivToken.waitForDeployment()
  const tokenAddress = await elusivToken.getAddress()
  console.log('ElusivToken deployed at:', tokenAddress)

  const Pass = await ethers.getContractFactory('ElusivAccessPass')
  const nftConfig = getNftConfig(ethers)
  const passTreasury = nftConfig.treasury || deployer.address
  const pass = await Pass.deploy(nftConfig.maxSupply, nftConfig.mintingEnabled, nftConfig.mintPrice, passTreasury)
  await pass.waitForDeployment()
  const passAddress = await pass.getAddress()
  console.log('ElusivAccessPass deployed at:', passAddress)

  const researchConfig = getResearchConfig(ethers)
  const Desk = await ethers.getContractFactory('ElusivResearchDesk')
  const desk = await Desk.deploy(tokenAddress, researchConfig.requestCost, researchConfig.maxQueryLength)
  await desk.waitForDeployment()
  const deskAddress = await desk.getAddress()
  console.log('ElusivResearchDesk deployed at:', deskAddress)

  // Optional: wait a couple of blocks before verify
  const waitBlocks = Number(process.env.VERIFY_WAIT_BLOCKS || 2)
  try {
    if (process.env.ETHERSCAN_API_KEY && network.name !== 'hardhat') {
      console.log(`Waiting ${waitBlocks} blocks before verification...`)
      const tx1 = elusivToken.deploymentTransaction()
      const tx2 = pass.deploymentTransaction()
      const tx3 = desk.deploymentTransaction()
      if (tx1) await tx1.wait(waitBlocks)
      if (tx2) await tx2.wait(waitBlocks)
      if (tx3) await tx3.wait(waitBlocks)

      console.log('Verifying ElusivToken...')
      await run('verify:verify', { address: tokenAddress, constructorArguments: [tokenTreasury] })
      console.log('Verifying ElusivAccessPass...')
      await run('verify:verify', { address: passAddress, constructorArguments: [nftConfig.maxSupply, nftConfig.mintingEnabled, nftConfig.mintPrice, passTreasury] })
      console.log('Verifying ElusivResearchDesk...')
      await run('verify:verify', { address: deskAddress, constructorArguments: [tokenAddress, researchConfig.requestCost, researchConfig.maxQueryLength] })
    } else {
      console.log('Skipping verification (ETHERSCAN_API_KEY not set or local network).')
    }
  } catch (e) {
    console.warn('Verification step failed:', e?.message || e)
  }

  // Write addresses to frontend config
  const root = path.resolve(__dirname, '..', '..')
  const frontendAddressesPath = path.join(root, 'frontend', 'src', 'config', 'addresses.json')
  let existing = {}
  try {
    if (fs.existsSync(frontendAddressesPath)) {
      existing = JSON.parse(fs.readFileSync(frontendAddressesPath, 'utf8'))
    }
  } catch {}
  const updated = {
    ...existing,
    [String(chainId)]: {
      ElusivToken: tokenAddress,
      ElusivAccessPass: passAddress,
      ElusivResearchDesk: deskAddress
    }
  }
  fs.writeFileSync(frontendAddressesPath, JSON.stringify(updated, null, 2))
  console.log('Updated frontend addresses at:', frontendAddressesPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


