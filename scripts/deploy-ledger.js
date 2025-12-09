/* eslint-disable no-console */
// Production-oriented deploy using Ledger for signing and optional Etherscan verification

const fs = require('fs')
const path = require('path')
const hre = require('hardhat')
const { ethers, run } = hre
const TransportNodeHid = require('@ledgerhq/hw-transport-node-hid').default
const AppEth = require('@ledgerhq/hw-app-eth').default

const DEFAULT_DERIVATION_PATH = process.env.LEDGER_DERIVATION_PATH || "44'/60'/0'/0/0"

async function getLedgerAddress(eth) {
  const { address } = await eth.getAddress(DEFAULT_DERIVATION_PATH, false, true)
  return address
}

function getNftConfig() {
  const maxSupplyEnv = process.env.NFT_MAX_SUPPLY || '1000'
  const mintingEnabledEnv = process.env.NFT_MINTING_ENABLED || 'false'
  const mintPriceEnv = process.env.NFT_MINT_PRICE_WEI || ethers.parseEther('0.01').toString()
  return {
    maxSupply: BigInt(maxSupplyEnv),
    mintingEnabled: mintingEnabledEnv === 'true',
    mintPrice: BigInt(mintPriceEnv),
    treasury: process.env.NFT_TREASURY || null
  }
}

function getResearchConfig() {
  const costTokens = process.env.RESEARCH_COST_TOKENS || '10'
  const maxQueryLenEnv = process.env.RESEARCH_MAX_QUERY_BYTES || `${512}`
  return { requestCost: ethers.parseUnits(costTokens, 18), maxQueryLength: Number(maxQueryLenEnv) || 512 }
}

async function signAndSendTx({ provider, eth, from, to, data, chainId, confirmations = 2 }) {
  const nonce = await provider.getTransactionCount(from)
  const feeData = await provider.getFeeData()
  const gasLimit = await provider.estimateGas({ from, to, data })

  let unsigned
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    unsigned = { nonce, to, value: 0n, data, gasLimit, chainId, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas }
  } else {
    const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei')
    unsigned = { nonce, to, value: 0n, data, gasLimit, chainId, gasPrice }
  }

  const rawUnsigned = ethers.serializeTransaction(unsigned)
  const ledgerSig = await eth.signTransaction(DEFAULT_DERIVATION_PATH, rawUnsigned.slice(2))
  const signature = {
    v: Number(ledgerSig.v),
    r: '0x' + ledgerSig.r,
    s: '0x' + ledgerSig.s
  }
  const signed = ethers.serializeTransaction(unsigned, signature)
  const tx = await provider.broadcastTransaction(signed)
  const receipt = await tx.wait(confirmations)
  return receipt
}

async function signAndSendCreationTx(args) {
  return signAndSendTx({ ...args, to: undefined })
}

async function main() {
  const rpcUrl = process.env.RPC_URL || process.env.HARDHAT_SEPOLIA_RPC_URL
  if (!rpcUrl) throw new Error('Set RPC_URL (or HARDHAT_SEPOLIA_RPC_URL)')
  const confirmations = Number(process.env.CONFIRMATIONS || '2')
  const dryRun = process.env.DRY_RUN === '1'

  const transport = await TransportNodeHid.create()
  const eth = new AppEth(transport)
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const network = await provider.getNetwork()
  const chainId = Number(network.chainId)

  const from = await getLedgerAddress(eth)
  const balance = await provider.getBalance(from)
  console.log('Network chainId:', chainId)
  console.log('Ledger address:', from)
  console.log('Balance:', ethers.formatEther(balance), 'ETH')
  if (balance === 0n) console.warn('Warning: Deployer balance is 0. Use a faucet/fund this address before deploying.')

  // Prepare deploy data via ContractFactory to ensure correct constructor encoding
  const TokenFactory = await ethers.getContractFactory('ElusivToken')
  const tokenTreasury = process.env.TOKEN_TREASURY || from
  const tokenDeployTx = await TokenFactory.getDeployTransaction(tokenTreasury)
  if (dryRun) {
    const est = await provider.estimateGas({ from, to: undefined, data: tokenDeployTx.data })
    console.log('DRY RUN - ElusivToken would deploy with gasLimit:', est.toString())
  }
  const tokenReceipt = dryRun ? null : await signAndSendCreationTx({ provider, eth, from, data: tokenDeployTx.data, chainId, confirmations })
  const tokenAddress = dryRun ? '(dry-run)' : tokenReceipt.contractAddress
  console.log('ElusivToken:', tokenAddress)

  const nftConfig = getNftConfig()
  const passTreasury = nftConfig.treasury || from
  const PassFactory = await ethers.getContractFactory('ElusivAccessPass')
  const passDeployTx = await PassFactory.getDeployTransaction(nftConfig.maxSupply, nftConfig.mintingEnabled, nftConfig.mintPrice, passTreasury)
  if (dryRun) {
    const est = await provider.estimateGas({ from, to: undefined, data: passDeployTx.data })
    console.log('DRY RUN - ElusivAccessPass would deploy with gasLimit:', est.toString())
  }
  const passReceipt = dryRun ? null : await signAndSendCreationTx({ provider, eth, from, data: passDeployTx.data, chainId, confirmations })
  const passAddress = dryRun ? '(dry-run)' : passReceipt.contractAddress
  console.log('ElusivAccessPass:', passAddress)

  const researchConfig = getResearchConfig()
  const tokenAddressForDesk = dryRun ? from : tokenAddress
  const DeskFactory = await ethers.getContractFactory('ElusivResearchDesk')
  const deskDeployTx = await DeskFactory.getDeployTransaction(tokenAddressForDesk, researchConfig.requestCost, researchConfig.maxQueryLength)
  if (dryRun) {
    const est = await provider.estimateGas({ from, to: undefined, data: deskDeployTx.data })
    console.log('DRY RUN - ElusivResearchDesk would deploy with gasLimit:', est.toString())
  }
  const deskReceipt = dryRun ? null : await signAndSendCreationTx({ provider, eth, from, data: deskDeployTx.data, chainId, confirmations })
  const deskAddress = dryRun ? '(dry-run)' : deskReceipt.contractAddress
  console.log('ElusivResearchDesk:', deskAddress)

  // Optional verification
  try {
    if (process.env.ETHERSCAN_API_KEY && !dryRun) {
      console.log('Verifying on Etherscan...')
      await run('verify:verify', { address: tokenAddress, constructorArguments: [tokenTreasury] })
      await run('verify:verify', { address: passAddress, constructorArguments: [nftConfig.maxSupply, nftConfig.mintingEnabled, nftConfig.mintPrice, passTreasury] })
      await run('verify:verify', { address: deskAddress, constructorArguments: [tokenAddress, researchConfig.requestCost, researchConfig.maxQueryLength] })
    } else {
      console.log('Skipping Etherscan verification (dry run or ETHERSCAN_API_KEY not set).')
    }
  } catch (e) {
    console.warn('Verification failed or skipped:', e?.message || e)
  }

  // Write addresses to frontend config
  const root = path.resolve(__dirname, '..', '..')
  const frontendAddressesPath = path.join(root, 'frontend', 'src', 'config', 'addresses.json')
  if (!dryRun) {
    let existing = {}
    try { if (fs.existsSync(frontendAddressesPath)) existing = JSON.parse(fs.readFileSync(frontendAddressesPath, 'utf8')) } catch {}
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
  } else {
    console.log('DRY RUN - Skipping writes to frontend addresses.json')
  }

  await transport.close()
}

main().catch(async (e) => {
  console.error(e)
  process.exit(1)
})


