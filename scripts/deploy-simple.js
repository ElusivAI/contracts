/*
  Minimal deploy (no third-party services).
  Best practices included: chain guard, min balance, EIP-1559 fees, confirmations,
  per-chain deployment records, and frontend addresses update.

  Env:
  - RPC_URL=https://...
  - PRIVATE_KEY=0x...
  - MIN_BALANCE_ETH=0.05 (optional)
  - CONFIRMATIONS=2 (optional)
  - ALLOW_MAINNET=0/1 (default 0 - blocks chainId 1)
  - DEPLOYMENTS_DIR=./contracts/deployments (optional)
*/
/* eslint-disable no-console */
const { ethers } = require('hardhat')
const fs = require('fs')
const path = require('path')

function now() { return new Date().toISOString() }
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) }

function readJson(p) { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null } catch { return null } }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)) }

function getNftConfig() {
  const maxSupplyEnv = process.env.NFT_MAX_SUPPLY || '1000'
  const mintingEnabledEnv = process.env.NFT_MINTING_ENABLED || 'false'
  const mintPriceEnv = process.env.NFT_MINT_PRICE_WEI || ethers.parseEther('0.01').toString()
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
  const rpcUrl = process.env.RPC_URL
  const privKey = process.env.PRIVATE_KEY
  if (!rpcUrl || !privKey) {
    console.error('Missing RPC_URL or PRIVATE_KEY in env')
    process.exit(1)
  }

  const minBalanceEth = Number(process.env.MIN_BALANCE_ETH || '0.05')
  const confirmations = Number(process.env.CONFIRMATIONS || '2')
  const allowMainnet = process.env.ALLOW_MAINNET === '1'
  const deploymentsDir = path.resolve(process.env.DEPLOYMENTS_DIR || path.join(__dirname, '..', 'deployments'))
  const dryRun = process.env.DRY_RUN === '1'

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(privKey, provider)
  const net = await provider.getNetwork()
  const chainId = Number(net.chainId)

  console.log(`[${now()}] Network chainId: ${chainId}`)
  if (chainId === 1 && !allowMainnet) {
    console.error('Mainnet deployment blocked. Set ALLOW_MAINNET=1 to proceed.')
    process.exit(1)
  }
  console.log(`[${now()}] Deployer: ${wallet.address}`)
  const balance = await provider.getBalance(wallet.address)
  const balanceEth = Number(ethers.formatEther(balance))
  console.log(`[${now()}] Balance: ${balanceEth} ETH`)
  if (balanceEth < minBalanceEth) {
    console.error(`Balance ${balanceEth} ETH is below MIN_BALANCE_ETH=${minBalanceEth}. Fund this account first.`)
    process.exit(1)
  }

  ensureDir(deploymentsDir)
  const chainFile = path.join(deploymentsDir, `${chainId}.json`)
  if (fs.existsSync(chainFile)) {
    console.log(`[${now()}] Found existing deployments file: ${chainFile}`)
  }

  // Prefer EIP-1559 fees with fallback
  const feeData = await provider.getFeeData()
  const maxFeePerGas = feeData.maxFeePerGas || undefined
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || undefined

  const commonOverrides = (est) => (
    maxFeePerGas && maxPriorityFeePerGas
      ? { maxFeePerGas, maxPriorityFeePerGas, gasLimit: est }
      : { gasPrice: feeData.gasPrice || ethers.parseUnits('20', 'gwei'), gasLimit: est }
  )

  const Token = await ethers.getContractFactory('ElusivToken', wallet)
  const tokenTreasury = process.env.TOKEN_TREASURY || wallet.address
  const tokenDeployTx = await Token.getDeployTransaction(tokenTreasury)
  const tokenEst = await provider.estimateGas({ from: wallet.address, data: tokenDeployTx.data })
  if (dryRun) {
    const ov = commonOverrides(tokenEst)
    const feePerGas = ov.maxFeePerGas || ov.gasPrice
    const fee = feePerGas ? Number(ethers.formatEther(feePerGas * tokenEst)) : undefined
    console.log(`[${now()}] DRY RUN - ElusivToken would deploy with gasLimit=${tokenEst} feePerGas=${feePerGas?.toString() || 'n/a'} estFeeETH=${fee ?? 'n/a'}`)
  }
  const elusivToken = dryRun ? null : await Token.deploy(tokenTreasury, commonOverrides(tokenEst))
  const tokenReceipt = dryRun ? null : await elusivToken.deploymentTransaction().wait(confirmations)
  const tokenAddress = dryRun ? '(dry-run)' : await elusivToken.getAddress()
  console.log(`[${now()}] ElusivToken: ${tokenAddress}${dryRun ? '' : ` (tx: ${tokenReceipt.hash})`}`)

  const nftConfig = getNftConfig()
  const Pass = await ethers.getContractFactory('ElusivAccessPass', wallet)
  const passTreasury = nftConfig.treasury || wallet.address
  const passDeployTx = await Pass.getDeployTransaction(nftConfig.maxSupply, nftConfig.mintingEnabled, nftConfig.mintPrice, passTreasury)
  const passEst = await provider.estimateGas({ from: wallet.address, data: passDeployTx.data })
  if (dryRun) {
    const ov = commonOverrides(passEst)
    const feePerGas = ov.maxFeePerGas || ov.gasPrice
    const fee = feePerGas ? Number(ethers.formatEther(feePerGas * passEst)) : undefined
    console.log(`[${now()}] DRY RUN - ElusivAccessPass would deploy with gasLimit=${passEst} feePerGas=${feePerGas?.toString() || 'n/a'} estFeeETH=${fee ?? 'n/a'}`)
  }
  const pass = dryRun ? null : await Pass.deploy(nftConfig.maxSupply, nftConfig.mintingEnabled, nftConfig.mintPrice, passTreasury, commonOverrides(passEst))
  const passReceipt = dryRun ? null : await pass.deploymentTransaction().wait(confirmations)
  const passAddress = dryRun ? '(dry-run)' : await pass.getAddress()
  console.log(`[${now()}] ElusivAccessPass: ${passAddress}${dryRun ? '' : ` (tx: ${passReceipt.hash})`}`)

  const researchConfig = getResearchConfig()
  const tokenAddressForDesk = dryRun ? wallet.address : tokenAddress
  const Desk = await ethers.getContractFactory('ElusivResearchDesk', wallet)
  const deskDeployTx = await Desk.getDeployTransaction(tokenAddressForDesk, researchConfig.requestCost, researchConfig.maxQueryLength)
  const deskEst = await provider.estimateGas({ from: wallet.address, data: deskDeployTx.data })
  if (dryRun) {
    const ov = commonOverrides(deskEst)
    const feePerGas = ov.maxFeePerGas || ov.gasPrice
    const fee = feePerGas ? Number(ethers.formatEther(feePerGas * deskEst)) : undefined
    console.log(`[${now()}] DRY RUN - ElusivResearchDesk would deploy with gasLimit=${deskEst} feePerGas=${feePerGas?.toString() || 'n/a'} estFeeETH=${fee ?? 'n/a'}`)
  }
  const desk = dryRun ? null : await Desk.deploy(tokenAddressForDesk, researchConfig.requestCost, researchConfig.maxQueryLength, commonOverrides(deskEst))
  const deskReceipt = dryRun ? null : await desk.deploymentTransaction().wait(confirmations)
  const deskAddress = dryRun ? '(dry-run)' : await desk.getAddress()
  console.log(`[${now()}] ElusivResearchDesk: ${deskAddress}${dryRun ? '' : ` (tx: ${deskReceipt.hash})`}`)

  // Sanity check: code present
  if (!dryRun) {
    const tokenCode = await provider.getCode(tokenAddress)
    const passCode = await provider.getCode(passAddress)
    const deskCode = await provider.getCode(deskAddress)
    if (!tokenCode || tokenCode === '0x' || !passCode || passCode === '0x' || !deskCode || deskCode === '0x') {
      console.error('Deployed contract code not found. Aborting writes.')
      process.exit(1)
    }
  }

  // Write per-chain deployments file
  if (!dryRun) {
    const prev = readJson(chainFile) || {}
    const record = {
      ...prev,
      ElusivToken: { address: tokenAddress, txHash: tokenReceipt.hash, blockNumber: tokenReceipt.blockNumber, deployedAt: now() },
      ElusivAccessPass: { address: passAddress, txHash: passReceipt.hash, blockNumber: passReceipt.blockNumber, deployedAt: now() },
      ElusivResearchDesk: { address: deskAddress, txHash: deskReceipt.hash, blockNumber: deskReceipt.blockNumber, deployedAt: now() }
    }
    writeJson(chainFile, record)
    console.log(`[${now()}] Wrote deployments: ${chainFile}`)
  }

  // Update frontend addresses.json
  const root = path.resolve(__dirname, '..', '..')
  const frontendAddressesPath = path.join(root, 'frontend', 'src', 'config', 'addresses.json')
  const frontendDir = path.dirname(frontendAddressesPath)

  if (!dryRun) {
    if (fs.existsSync(frontendDir)) {
      let existing = readJson(frontendAddressesPath) || {}
      const updated = {
        ...existing,
        [String(chainId)]: {
          ElusivToken: tokenAddress,
          ElusivAccessPass: passAddress,
          ElusivResearchDesk: deskAddress
        }
      }
      writeJson(frontendAddressesPath, updated)
      console.log(`[${now()}] Updated frontend addresses at: ${frontendAddressesPath}`)
    } else {
      console.log(`[${now()}] Frontend directory not found at ${frontendDir}, skipping address update.`)
    }
  } else {
    console.log(`[${now()}] DRY RUN - Skipping writes to deployments and frontend addresses.json`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })


