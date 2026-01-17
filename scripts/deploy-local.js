#!/usr/bin/env node

/**
 * Quick deployment script for local Hardhat testing
 * Deploys all contracts and mints an NFT to a test account
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-local.js --network localhost
 * 
 * Or with environment variables:
 *   SEED_TO=0x... npx hardhat run scripts/deploy-local.js --network localhost
 */

const fs = require('fs')
const path = require('path')
const { ethers } = require('hardhat')

async function main() {
  console.log('🚀 Deploying contracts to local Hardhat network...\n')

  const [deployer, user] = await ethers.getSigners()
  const seedTo = process.env.SEED_TO || user.address

  console.log('📋 Configuration:')
  console.log(`   Deployer: ${deployer.address}`)
  console.log(`   Seed NFT to: ${seedTo}`)
  console.log(`   Network: localhost (31337)\n`)

  // Deploy ElusivToken
  console.log('📦 Deploying ElusivToken...')
  const Token = await ethers.getContractFactory('ElusivToken')
  const elusivToken = await Token.deploy(deployer.address)
  await elusivToken.waitForDeployment()
  const tokenAddress = await elusivToken.getAddress()
  console.log(`   ✅ ElusivToken: ${tokenAddress}`)

  // Transfer tokens to seed account
  const transferTx = await elusivToken.transfer(seedTo, ethers.parseEther('10000'))
  await transferTx.wait()
  console.log(`   ✅ Transferred 10,000 ELUSIV to ${seedTo}`)

  // Deploy ElusivAccessPass
  console.log('\n📦 Deploying ElusivAccessPass...')
  const maxSupply = process.env.NFT_MAX_SUPPLY || '1000'
  const mintingEnabled = (process.env.NFT_MINTING_ENABLED || 'true') === 'true'
  const mintPrice = process.env.NFT_MINT_PRICE_WEI || ethers.parseEther('0.001').toString()
  
  const Pass = await ethers.getContractFactory('ElusivAccessPass')
  const pass = await Pass.deploy(
    maxSupply,
    mintingEnabled,
    mintPrice,
    deployer.address
  )
  await pass.waitForDeployment()
  const passAddress = await pass.getAddress()
  console.log(`   ✅ ElusivAccessPass: ${passAddress}`)
  console.log(`   📊 Max Supply: ${maxSupply}`)
  console.log(`   🔓 Minting Enabled: ${mintingEnabled}`)
  console.log(`   💰 Mint Price: ${ethers.formatEther(mintPrice)} ETH`)

  // Mint NFT to seed account (only if SKIP_SEED_MINT is not set)
  if (!process.env.SKIP_SEED_MINT) {
    console.log(`\n🎫 Minting Access Pass to ${seedTo}...`)
    const mintTx = await pass.mint(seedTo)
    await mintTx.wait()
    console.log(`   ✅ Minted 1 Elusiv Access Pass to ${seedTo}`)
  } else {
    console.log(`\n⏭️  Skipping seed mint (SKIP_SEED_MINT=true)`)
  }

  // Deploy ElusivResearchDesk
  console.log('\n📦 Deploying ElusivResearchDesk...')
  const requestCost = process.env.RESEARCH_COST_TOKENS || '10'
  const maxQueryLength = process.env.RESEARCH_MAX_QUERY_BYTES || '512'
  
  const Desk = await ethers.getContractFactory('ElusivResearchDesk')
  const desk = await Desk.deploy(
    tokenAddress,
    ethers.parseUnits(requestCost, 18),
    maxQueryLength
  )
  await desk.waitForDeployment()
  const deskAddress = await desk.getAddress()
  console.log(`   ✅ ElusivResearchDesk: ${deskAddress}`)
  console.log(`   💰 Request Cost: ${requestCost} ELUSIV`)
  console.log(`   📏 Max Query Length: ${maxQueryLength} bytes`)

  // Update frontend addresses.json
  console.log('\n📝 Updating frontend addresses...')
  const root = path.resolve(__dirname, '..', '..')
  const addressesPath = path.join(root, 'frontend', 'src', 'config', 'addresses.json')
  
  let addresses = {}
  if (fs.existsSync(addressesPath)) {
    try {
      addresses = JSON.parse(fs.readFileSync(addressesPath, 'utf8'))
    } catch (err) {
      console.warn(`   ⚠️  Could not read existing addresses.json: ${err.message}`)
    }
  }

  addresses['31337'] = {
    ElusivToken: tokenAddress,
    ElusivAccessPass: passAddress,
    ElusivResearchDesk: deskAddress
  }

  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2))
  console.log(`   ✅ Updated ${addressesPath}`)

  // Write deployment record
  console.log('\n📝 Writing deployment record...')
  const deploymentsDir = path.join(__dirname, '..', 'deployments')
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true })
  }

  const deploymentRecord = {
    chainId: 31337,
    network: 'localhost',
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ElusivToken: {
        address: tokenAddress,
        deployedAt: new Date().toISOString()
      },
      ElusivAccessPass: {
        address: passAddress,
        maxSupply,
        mintingEnabled,
        mintPrice,
        deployedAt: new Date().toISOString()
      },
      ElusivResearchDesk: {
        address: deskAddress,
        requestCost,
        maxQueryLength,
        deployedAt: new Date().toISOString()
      }
    },
    seedAccount: {
      address: seedTo,
      hasToken: true,
      hasNFT: !process.env.SKIP_SEED_MINT
    }
  }

  const deploymentFile = path.join(deploymentsDir, '31337.json')
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentRecord, null, 2))
  console.log(`   ✅ Wrote deployment record to ${deploymentFile}`)

  // Summary
  console.log('\n✨ Deployment Summary:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Chain ID: 31337 (Hardhat Local)`)
  console.log(`\nContracts:`)
  console.log(`  ElusivToken:        ${tokenAddress}`)
  console.log(`  ElusivAccessPass:   ${passAddress}`)
  console.log(`  ElusivResearchDesk: ${deskAddress}`)
  console.log(`\nTest Account: ${seedTo}`)
  console.log(`  ✅ Has 10,000 ELUSIV tokens`)
  if (!process.env.SKIP_SEED_MINT) {
    console.log(`  ✅ Has 1 Access Pass NFT`)
  } else {
    console.log(`  ⏭️  No NFT (seed mint skipped for fresh start)`)
  }
  console.log('\n📋 Next Steps:')
  console.log('  1. Update api/.env with:')
  console.log(`     ACCESS_PASS_CONTRACT=${passAddress}`)
  console.log(`     RPC_URL=http://127.0.0.1:8545`)
  console.log(`     CHAIN_ID=31337`)
  console.log('  2. Start backend API: cd api && npm start')
  console.log('  3. Start frontend: cd frontend && npm run dev')
  console.log('  4. Connect MetaMask to Hardhat Local network')
  console.log('  5. Import test account private key to MetaMask')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Deployment failed:')
    console.error(error)
    process.exit(1)
  })
