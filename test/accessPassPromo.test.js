const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('ElusivAccessPass promo and affiliate', function () {
  let token
  let pass
  let owner
  let affiliate
  let buyer
  let other
  const mintPrice = ethers.parseEther('0.01')
  const decimalsMultiplier = 10n ** 18n

  beforeEach(async function () {
    [owner, affiliate, buyer, other] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const Pass = await ethers.getContractFactory('ElusivAccessPass')
    pass = await Pass.deploy(1000n, true, mintPrice, owner.address)
    await pass.waitForDeployment()
  })

  describe('Affiliate Settings', function () {
    it('setAffiliateSettings sets all 6 parameters and emits AffiliateSettingsUpdated', async function () {
      const tokenAddress = await token.getAddress()
      await expect(
        pass.setAffiliateSettings(2000, 1000, ethers.parseEther('10'), tokenAddress, true, true)
      )
        .to.emit(pass, 'AffiliateSettingsUpdated')
        .withArgs(2000, 1000, ethers.parseEther('10'), tokenAddress, true, true, owner.address)
      expect(await pass.maxAffiliateFeeBps()).to.equal(2000)
      expect(await pass.defaultAffiliateFeeBps()).to.equal(1000)
      expect(await pass.defaultTokenReward()).to.equal(ethers.parseEther('10'))
      expect(await pass.elusivToken()).to.equal(tokenAddress)
      expect(await pass.allowSelfReferral()).to.equal(true)
      expect(await pass.tokenRewardsEnabled()).to.equal(true)
    })

    it('reverts AffiliateFeeTooHigh when maxBps > AFFILIATE_FEE_ABSOLUTE_MAX (5000)', async function () {
      await expect(
        pass.setAffiliateSettings(5001, 1000, 0, ethers.ZeroAddress, false, false)
      ).to.be.revertedWithCustomError(pass, 'AffiliateFeeTooHigh')
    })

    it('reverts AffiliateFeeTooHigh when defaultBps > maxBps', async function () {
      await expect(
        pass.setAffiliateSettings(1000, 1001, 0, ethers.ZeroAddress, false, false)
      ).to.be.revertedWithCustomError(pass, 'AffiliateFeeTooHigh')
    })

    it('reverts InvalidRewardToken when rewardsEnabled=true with zero token address', async function () {
      await expect(
        pass.setAffiliateSettings(1000, 1000, 0, ethers.ZeroAddress, false, true)
      ).to.be.revertedWithCustomError(pass, 'InvalidRewardToken')
    })

    it('reverts when non-owner calls setAffiliateSettings', async function () {
      await expect(
        pass.connect(other).setAffiliateSettings(1000, 1000, 0, ethers.ZeroAddress, false, false)
      ).to.be.revertedWithCustomError(pass, 'OwnableUnauthorizedAccount')
    })
  })

  describe('Promo Code CRUD (Owner)', function () {
    const codeHash = ethers.keccak256(ethers.toUtf8Bytes('PROMO1'))

    it('setPromoCode creates promo and getPromoCode returns it', async function () {
      await expect(
        pass.setPromoCode(codeHash, affiliate.address, 1000, ethers.parseEther('5'), true)
      )
        .to.emit(pass, 'PromoCreated')
        .withArgs(codeHash, affiliate.address, 1000, ethers.parseEther('5'))
      const promo = await pass.getPromoCode(codeHash)
      expect(promo.affiliate).to.equal(affiliate.address)
      expect(promo.feeBps).to.equal(1000)
      expect(promo.tokenReward).to.equal(ethers.parseEther('5'))
      expect(promo.active).to.equal(true)
    })

    it('setPromoCode updates existing promo and emits PromoUpdated', async function () {
      await pass.setPromoCode(codeHash, affiliate.address, 1000, 0, true)
      await expect(
        pass.setPromoCode(codeHash, other.address, 500, ethers.parseEther('1'), true)
      )
        .to.emit(pass, 'PromoUpdated')
        .withArgs(codeHash, other.address, 500, ethers.parseEther('1'), true)
      const promo = await pass.getPromoCode(codeHash)
      expect(promo.affiliate).to.equal(other.address)
      expect(promo.feeBps).to.equal(500)
      expect(promo.tokenReward).to.equal(ethers.parseEther('1'))
    })

    it('setPromoCodeWithDefault uses defaultTokenReward', async function () {
      await pass.setAffiliateSettings(1000, 1000, ethers.parseEther('7'), await token.getAddress(), false, false)
      await pass.setPromoCodeWithDefault(codeHash, affiliate.address, 1000, true)
      const promo = await pass.getPromoCode(codeHash)
      expect(promo.tokenReward).to.equal(ethers.parseEther('7'))
    })

    it('reverts InvalidPromoCode with bytes32(0) code', async function () {
      await expect(
        pass.setPromoCode(ethers.ZeroHash, affiliate.address, 1000, 0, true)
      ).to.be.revertedWithCustomError(pass, 'InvalidPromoCode')
    })

    it('reverts InvalidPromoCode with address(0) affiliate', async function () {
      await expect(
        pass.setPromoCode(codeHash, ethers.ZeroAddress, 1000, 0, true)
      ).to.be.revertedWithCustomError(pass, 'InvalidPromoCode')
    })

    it('reverts AffiliateFeeTooHigh when feeBps > maxAffiliateFeeBps', async function () {
      await pass.setAffiliateSettings(500, 500, 0, ethers.ZeroAddress, false, false)
      await expect(
        pass.setPromoCode(codeHash, affiliate.address, 501, 0, true)
      ).to.be.revertedWithCustomError(pass, 'AffiliateFeeTooHigh')
    })

    it('reverts AffiliateFeeTooHigh when feeBps > AFFILIATE_FEE_ABSOLUTE_MAX (5000)', async function () {
      await pass.setAffiliateSettings(5000, 5000, 0, ethers.ZeroAddress, false, false)
      await expect(
        pass.setPromoCode(codeHash, affiliate.address, 5001, 0, true)
      ).to.be.revertedWithCustomError(pass, 'AffiliateFeeTooHigh')
    })

    it('disablePromoCode sets active=false and emits PromoDisabled', async function () {
      await pass.setPromoCode(codeHash, affiliate.address, 1000, 0, true)
      await expect(pass.disablePromoCode(codeHash))
        .to.emit(pass, 'PromoDisabled')
        .withArgs(codeHash)
      const promo = await pass.getPromoCode(codeHash)
      expect(promo.active).to.equal(false)
    })

    it('reverts InvalidPromoCode when disabling non-existent code', async function () {
      const unknownCode = ethers.keccak256(ethers.toUtf8Bytes('UNKNOWN'))
      await expect(pass.disablePromoCode(unknownCode)).to.be.revertedWithCustomError(pass, 'InvalidPromoCode')
    })

    it('reverts when non-owner calls setPromoCode', async function () {
      await expect(
        pass.connect(other).setPromoCode(codeHash, affiliate.address, 1000, 0, true)
      ).to.be.revertedWithCustomError(pass, 'OwnableUnauthorizedAccount')
    })

    it('reverts when non-owner calls disablePromoCode', async function () {
      await pass.setPromoCode(codeHash, affiliate.address, 1000, 0, true)
      await expect(pass.connect(other).disablePromoCode(codeHash)).to.be.revertedWithCustomError(pass, 'OwnableUnauthorizedAccount')
    })
  })

  describe('Self-Service Promo Registration', function () {
    const codeString = 'HOLDERCODE'

    it('registerPromoCode allows pass holder to register and emits PromoCreated', async function () {
      await pass.mint(affiliate.address)
      const codeHash = ethers.keccak256(ethers.toUtf8Bytes(codeString))
      await expect(pass.connect(affiliate).registerPromoCode(codeString))
        .to.emit(pass, 'PromoCreated')
      const promo = await pass.getPromoCode(codeHash)
      expect(promo.affiliate).to.equal(affiliate.address)
      expect(promo.feeBps).to.equal(await pass.defaultAffiliateFeeBps())
      expect(promo.tokenReward).to.equal(await pass.defaultTokenReward())
      expect(promo.active).to.equal(true)
    })

    it('reverts PromoRequiresPass when caller holds no pass', async function () {
      await expect(pass.connect(buyer).registerPromoCode(codeString))
        .to.be.revertedWithCustomError(pass, 'PromoRequiresPass')
    })

    it('reverts PromoAlreadyExists on duplicate code', async function () {
      await pass.mint(affiliate.address)
      await pass.connect(affiliate).registerPromoCode(codeString)
      await expect(pass.connect(affiliate).registerPromoCode(codeString))
        .to.be.revertedWithCustomError(pass, 'PromoAlreadyExists')
    })

    it('reverts InvalidPromoCode on empty string', async function () {
      await pass.mint(affiliate.address)
      await expect(pass.connect(affiliate).registerPromoCode(''))
        .to.be.revertedWithCustomError(pass, 'InvalidPromoCode')
    })
  })

  describe('Public Mint with Promo Code', function () {
    const codeHash = ethers.keccak256(ethers.toUtf8Bytes('MINTCODE'))

    it('publicMint(promoCode) splits ETH to affiliate and treasury and emits PromoUsed', async function () {
      await pass.setPromoCode(codeHash, affiliate.address, 1000, 0, true)
      const affiliateBefore = await ethers.provider.getBalance(affiliate.address)
      const treasuryBefore = await ethers.provider.getBalance(owner.address)
      const expectedAffiliate = (mintPrice * 1000n) / 10000n
      const expectedTreasury = mintPrice - expectedAffiliate
      await expect(pass.connect(buyer).publicMint(codeHash, { value: mintPrice }))
        .to.emit(pass, 'PromoUsed')
        .withArgs(codeHash, buyer.address, affiliate.address, expectedAffiliate, 0)
      const affiliateAfter = await ethers.provider.getBalance(affiliate.address)
      const treasuryAfter = await ethers.provider.getBalance(owner.address)
      expect(affiliateAfter - affiliateBefore).to.equal(expectedAffiliate)
      expect(treasuryAfter - treasuryBefore).to.equal(expectedTreasury)
    })

    it('token rewards transfer to affiliate when tokenRewardsEnabled and contract funded', async function () {
      await pass.setAffiliateSettings(1000, 1000, ethers.parseEther('10'), await token.getAddress(), false, true)
      await token.transfer(await pass.getAddress(), ethers.parseEther('100'))
      await pass.setPromoCode(codeHash, affiliate.address, 1000, ethers.parseEther('10'), true)
      const affiliateBalanceBefore = await token.balanceOf(affiliate.address)
      await pass.connect(buyer).publicMint(codeHash, { value: mintPrice })
      expect(await token.balanceOf(affiliate.address)).to.equal(affiliateBalanceBefore + ethers.parseEther('10'))
    })

    it('reverts InvalidPromoCode with non-existent code', async function () {
      const unknownCode = ethers.keccak256(ethers.toUtf8Bytes('NONEXISTENT'))
      await expect(
        pass.connect(buyer).publicMint(unknownCode, { value: mintPrice })
      ).to.be.revertedWithCustomError(pass, 'InvalidPromoCode')
    })

    it('reverts InvalidPromoCode with disabled code', async function () {
      await pass.setPromoCode(codeHash, affiliate.address, 1000, 0, true)
      await pass.disablePromoCode(codeHash)
      await expect(
        pass.connect(buyer).publicMint(codeHash, { value: mintPrice })
      ).to.be.revertedWithCustomError(pass, 'InvalidPromoCode')
    })

    it('reverts SelfReferralNotAllowed when allowSelfReferral=false and minter is affiliate', async function () {
      await pass.setAffiliateSettings(1000, 1000, 0, ethers.ZeroAddress, false, false)
      await pass.setPromoCode(codeHash, buyer.address, 1000, 0, true)
      await expect(
        pass.connect(buyer).publicMint(codeHash, { value: mintPrice })
      ).to.be.revertedWithCustomError(pass, 'SelfReferralNotAllowed')
    })

    it('reverts TokenRewardsUnavailable when contract has insufficient ELUSIV', async function () {
      await pass.setAffiliateSettings(1000, 1000, ethers.parseEther('10'), await token.getAddress(), false, true)
      await pass.setPromoCode(codeHash, affiliate.address, 1000, ethers.parseEther('10'), true)
      await expect(
        pass.connect(buyer).publicMint(codeHash, { value: mintPrice })
      ).to.be.revertedWithCustomError(pass, 'TokenRewardsUnavailable')
    })

    it('promo mint works when tokenRewardsEnabled=false (ETH split only)', async function () {
      await pass.setAffiliateSettings(1000, 1000, ethers.parseEther('10'), await token.getAddress(), false, false)
      await pass.setPromoCode(codeHash, affiliate.address, 1000, ethers.parseEther('10'), true)
      const affiliateBefore = await ethers.provider.getBalance(affiliate.address)
      await pass.connect(buyer).publicMint(codeHash, { value: mintPrice })
      const expectedAffiliate = (mintPrice * 1000n) / 10000n
      expect(await ethers.provider.getBalance(affiliate.address)).to.equal(affiliateBefore + expectedAffiliate)
      expect(await pass.balanceOf(buyer.address)).to.equal(1n)
    })
  })

  describe('Payment Edge Cases', function () {
    it('reverts IncorrectMintPayment when msg.value != mintPrice', async function () {
      await expect(
        pass.connect(buyer).publicMint(ethers.ZeroHash, { value: ethers.parseEther('0.005') })
      ).to.be.revertedWithCustomError(pass, 'IncorrectMintPayment')
    })

    it('reverts SoldOut when nextTokenId >= maxSupply', async function () {
      const Pass2 = await ethers.getContractFactory('ElusivAccessPass')
      const smallPass = await Pass2.deploy(1n, true, mintPrice, owner.address)
      await smallPass.waitForDeployment()
      await smallPass.connect(buyer).publicMint(ethers.ZeroHash, { value: mintPrice })
      await expect(
        smallPass.connect(other).publicMint(ethers.ZeroHash, { value: mintPrice })
      ).to.be.revertedWithCustomError(smallPass, 'SoldOut')
    })

    it('setMintPrice succeeds and emits MintPriceUpdated', async function () {
      const newPrice = ethers.parseEther('0.02')
      await expect(pass.setMintPrice(newPrice))
        .to.emit(pass, 'MintPriceUpdated')
        .withArgs(newPrice, owner.address)
      expect(await pass.mintPrice()).to.equal(newPrice)
    })

    it('reverts MintPriceRequired when setMintPrice(0)', async function () {
      await expect(pass.setMintPrice(0)).to.be.revertedWithCustomError(pass, 'MintPriceRequired')
    })
  })

  describe('ETH Withdrawal', function () {
    it('withdraw sends ETH to recipient and emits FundsWithdrawn', async function () {
      const Funder = await ethers.getContractFactory('CommunityPoolEthFunder')
      const funder = await Funder.deploy()
      await funder.waitForDeployment()
      const amount = ethers.parseEther('0.005')
      await funder.fund(await pass.getAddress(), { value: amount })
      const otherBefore = await ethers.provider.getBalance(other.address)
      await expect(pass.withdraw(other.address, amount))
        .to.emit(pass, 'FundsWithdrawn')
        .withArgs(other.address, amount, owner.address)
      expect(await ethers.provider.getBalance(other.address)).to.equal(otherBefore + amount)
    })

    it('reverts InvalidTreasury when to=address(0)', async function () {
      const Funder = await ethers.getContractFactory('CommunityPoolEthFunder')
      const funder = await Funder.deploy()
      await funder.waitForDeployment()
      await funder.fund(await pass.getAddress(), { value: 1n })
      await expect(pass.withdraw(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(pass, 'InvalidTreasury')
    })

    it('reverts when amount > balance', async function () {
      const Funder = await ethers.getContractFactory('CommunityPoolEthFunder')
      const funder = await Funder.deploy()
      await funder.waitForDeployment()
      await funder.fund(await pass.getAddress(), { value: ethers.parseEther('0.001') })
      await expect(pass.withdraw(other.address, ethers.parseEther('0.002'))).to.be.revertedWith('Insufficient balance')
    })

    it('reverts when non-owner calls withdraw', async function () {
      const Funder = await ethers.getContractFactory('CommunityPoolEthFunder')
      const funder = await Funder.deploy()
      await funder.waitForDeployment()
      await funder.fund(await pass.getAddress(), { value: 1n })
      await expect(pass.connect(other).withdraw(other.address, 1n)).to.be.revertedWithCustomError(pass, 'OwnableUnauthorizedAccount')
    })
  })

  describe('Token URI and Metadata', function () {
    it('setBaseURI emits BaseURIUpdated', async function () {
      const newUri = 'https://example.com/metadata/'
      await expect(pass.setBaseURI(newUri))
        .to.emit(pass, 'BaseURIUpdated')
        .withArgs(newUri, owner.address)
      expect(await pass.baseTokenURI()).to.equal(newUri)
    })

    it('tokenURI returns baseTokenURI as-is when no trailing slash', async function () {
      await pass.mint(buyer.address)
      const base = 'https://example.com/static'
      await pass.setBaseURI(base)
      expect(await pass.tokenURI(0)).to.equal(base)
    })

    it('tokenURI appends tokenId when base has trailing slash', async function () {
      await pass.mint(buyer.address)
      await pass.setBaseURI('https://example.com/metadata/')
      expect(await pass.tokenURI(0)).to.equal('https://example.com/metadata/0')
    })

    it('tokenURI returns empty string when baseTokenURI is empty', async function () {
      await pass.mint(buyer.address)
      await pass.setBaseURI('')
      expect(await pass.tokenURI(0)).to.equal('')
    })

    it('tokenURI reverts on non-existent token', async function () {
      await expect(pass.tokenURI(999)).to.be.revertedWithCustomError(pass, 'ERC721NonexistentToken')
    })

    it('mintedCount returns correct count per wallet', async function () {
      await pass.connect(buyer).publicMint(ethers.ZeroHash, { value: mintPrice })
      expect(await pass.mintedCount(buyer.address)).to.equal(1n)
      expect(await pass.mintedCount(other.address)).to.equal(0n)
    })

    it('remainingSupply returns maxSupply - nextTokenId', async function () {
      expect(await pass.remainingSupply()).to.equal(1000n)
      await pass.mint(owner.address)
      expect(await pass.remainingSupply()).to.equal(999n)
      await pass.setMaxSupply(1n)
      expect(await pass.remainingSupply()).to.equal(0n)
    })

    it('creator returns Elusiv Labs', async function () {
      expect(await pass.creator()).to.equal('Elusiv Labs')
    })
  })

  describe('Receive Fallback', function () {
    it('sending raw ETH reverts with EtherNotAccepted', async function () {
      const passAddress = await pass.getAddress()
      await expect(
        owner.sendTransaction({ to: passAddress, value: ethers.parseEther('1') })
      ).to.be.revertedWithCustomError(pass, 'EtherNotAccepted')
    })
  })
})
