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

function getAffiliateConfig() {
  const maxAffiliateFeeBps = Number(process.env.AFFILIATE_MAX_FEE_BPS || 1000)
  const defaultAffiliateFeeBps = Number(process.env.AFFILIATE_DEFAULT_FEE_BPS || maxAffiliateFeeBps)
  const defaultTokenReward = process.env.AFFILIATE_DEFAULT_TOKEN_REWARD || '0'
  const allowSelfReferral = (process.env.AFFILIATE_ALLOW_SELF_REFERRAL || 'false').toLowerCase() === 'true'
  const rewardsEnabled = (process.env.AFFILIATE_REWARDS_ENABLED || 'true').toLowerCase() === 'true'
  const seedCode = process.env.AFFILIATE_SEED_CODE || ''
  const seedAffiliate = process.env.AFFILIATE_SEED_WALLET || ''
  const seedFeeBps = Number(process.env.AFFILIATE_SEED_FEE_BPS || maxAffiliateFeeBps)
  const seedTokenReward = process.env.AFFILIATE_SEED_TOKEN_REWARD || defaultTokenReward
  return {
    maxAffiliateFeeBps,
    defaultAffiliateFeeBps,
    defaultTokenReward: BigInt(defaultTokenReward),
    allowSelfReferral,
    rewardsEnabled,
    seedCode,
    seedAffiliate,
    seedFeeBps,
    seedTokenReward: BigInt(seedTokenReward)
  }
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

  const affiliateConfig = getAffiliateConfig()
  const affiliateTx = await pass.setAffiliateSettings(
    affiliateConfig.maxAffiliateFeeBps,
    affiliateConfig.defaultAffiliateFeeBps,
    affiliateConfig.defaultTokenReward,
    await elusivToken.getAddress(),
    affiliateConfig.allowSelfReferral,
    affiliateConfig.rewardsEnabled
  )
  await affiliateTx.wait()
  console.log('Configured affiliate settings')

  if (affiliateConfig.seedCode && affiliateConfig.seedAffiliate) {
    const codeHash = ethers.keccak256(ethers.toUtf8Bytes(affiliateConfig.seedCode.toUpperCase()))
    const seedTx = await pass.setPromoCode(
      codeHash,
      affiliateConfig.seedAffiliate,
      affiliateConfig.seedFeeBps,
      affiliateConfig.seedTokenReward,
      true
    )
    await seedTx.wait()
    console.log('Seed promo code created:', affiliateConfig.seedCode, 'hash:', codeHash)
  }

  const researchConfig = getResearchConfig()
  const Desk = await ethers.getContractFactory('ElusivResearchDesk')
  const desk = await Desk.deploy(await elusivToken.getAddress(), researchConfig.requestCost, researchConfig.maxQueryLength)
  await desk.waitForDeployment()
  console.log('ElusivResearchDesk:', await desk.getAddress())
}

main().catch((e) => { console.error(e); process.exit(1); })
