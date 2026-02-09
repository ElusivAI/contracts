const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('ElusivCommunityPool', function () {
  let token, pool, desk
  let owner, contributor, other
  const decimalsMultiplier = 10n ** 18n

  beforeEach(async function () {
    [owner, contributor, other] = await ethers.getSigners()

    const Token = await ethers.getContractFactory('ElusivToken')
    token = await Token.deploy(owner.address)
    await token.waitForDeployment()

    const Pool = await ethers.getContractFactory('ElusivCommunityPool')
    pool = await Pool.deploy(await token.getAddress())
    await pool.waitForDeployment()

    const Desk = await ethers.getContractFactory('ElusivContributionDesk')
    desk = await Desk.deploy(await token.getAddress(), 7 * 24 * 60 * 60, 3, 5)
    await desk.waitForDeployment()
  })

  describe('Deployment', function () {
    it('should deploy with correct token address', async function () {
      expect(await pool.elusivToken()).to.equal(await token.getAddress())
    })

    it('should have zero balance initially', async function () {
      expect(await pool.getBalance()).to.equal(0)
    })
  })

  describe('Deposit', function () {
    it('should allow anyone to deposit tokens', async function () {
      await token.transfer(contributor.address, 1000n * decimalsMultiplier)
      await token.connect(contributor).approve(await pool.getAddress(), 500n * decimalsMultiplier)

      await expect(pool.connect(contributor).deposit(500n * decimalsMultiplier))
        .to.emit(pool, 'Deposit')
        .withArgs(contributor.address, 500n * decimalsMultiplier)

      expect(await pool.getBalance()).to.equal(500n * decimalsMultiplier)
      expect(await token.balanceOf(await pool.getAddress())).to.equal(500n * decimalsMultiplier)
    })

    it('should reject zero amount deposit', async function () {
      await expect(pool.connect(contributor).deposit(0))
        .to.be.revertedWith('Amount must be > 0')
    })

    it('should accumulate multiple deposits', async function () {
      await token.transfer(contributor.address, 1000n * decimalsMultiplier)
      await token.connect(contributor).approve(await pool.getAddress(), 1000n * decimalsMultiplier)

      await pool.connect(contributor).deposit(300n * decimalsMultiplier)
      await pool.connect(contributor).deposit(200n * decimalsMultiplier)

      expect(await pool.getBalance()).to.equal(500n * decimalsMultiplier)
    })
  })

  describe('Withdrawal', function () {
    beforeEach(async function () {
      await token.transfer(await pool.getAddress(), 1000n * decimalsMultiplier)
      await pool.setContributionDesk(await desk.getAddress())
    })

    it('should allow contribution desk to withdraw through finalization', async function () {
      await desk.setCommunityPool(await pool.getAddress())
      await desk.addValidator(owner.address)
      await desk.addValidator(contributor.address)
      await desk.addValidator(other.address)

      await desk.connect(contributor).submitContribution(
        'Test',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        'Desc',
        500n * decimalsMultiplier
      )

      await desk.connect(owner).validatorVote(0, true)
      await desk.connect(contributor).validatorVote(0, true)
      await desk.connect(other).validatorVote(0, true)

      const balanceBefore = await token.balanceOf(contributor.address)
      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60 + 1])
      await ethers.provider.send('evm_mine', [])

      await expect(desk.finalizeContribution(0))
        .to.emit(pool, 'Withdrawal')
        .withArgs(contributor.address, 500n * decimalsMultiplier, await desk.getAddress())

      expect(await pool.getBalance()).to.equal(500n * decimalsMultiplier)
      expect(await token.balanceOf(contributor.address) - balanceBefore).to.equal(500n * decimalsMultiplier)
    })

    it('should allow owner to withdraw', async function () {
      const balanceBefore = await token.balanceOf(other.address)
      
      await expect(pool.connect(owner).withdraw(other.address, 300n * decimalsMultiplier))
        .to.emit(pool, 'Withdrawal')
        .withArgs(other.address, 300n * decimalsMultiplier, owner.address)

      expect(await pool.getBalance()).to.equal(700n * decimalsMultiplier)
      expect(await token.balanceOf(other.address) - balanceBefore).to.equal(300n * decimalsMultiplier)
    })

    it('should prevent unauthorized withdrawal', async function () {
      await expect(pool.connect(other).withdraw(contributor.address, 100n * decimalsMultiplier))
        .to.be.revertedWithCustomError(pool, 'NotAuthorized')
    })

    it('should reject withdrawal to zero address', async function () {
      await expect(pool.connect(owner).withdraw(ethers.ZeroAddress, 100n * decimalsMultiplier))
        .to.be.revertedWithCustomError(pool, 'InvalidAddress')
    })

    it('should reject zero amount withdrawal', async function () {
      await expect(pool.connect(owner).withdraw(contributor.address, 0))
        .to.be.revertedWithCustomError(pool, 'InsufficientBalance')
    })

    it('should reject withdrawal exceeding balance', async function () {
      await expect(pool.connect(owner).withdraw(contributor.address, 2000n * decimalsMultiplier))
        .to.be.revertedWithCustomError(pool, 'InsufficientBalance')
    })

    it('should prevent withdrawal if contribution desk not set', async function () {
      const Pool2 = await ethers.getContractFactory('ElusivCommunityPool')
      const pool2 = await Pool2.deploy(await token.getAddress())
      await pool2.waitForDeployment()

      await token.transfer(await pool2.getAddress(), 1000n * decimalsMultiplier)

      const Desk2 = await ethers.getContractFactory('ElusivContributionDesk')
      const desk2 = await Desk2.deploy(await token.getAddress(), 7 * 24 * 60 * 60, 3, 5)
      await desk2.waitForDeployment()

      await expect(pool2.connect(owner).withdraw(contributor.address, 100n * decimalsMultiplier))
        .to.be.revertedWithCustomError(pool2, 'ContributionDeskNotSet')
    })
  })

  describe('Contribution Desk Management', function () {
    it('should allow owner to set contribution desk', async function () {
      await expect(pool.setContributionDesk(await desk.getAddress()))
        .to.emit(pool, 'ContributionDeskUpdated')
        .withArgs(await desk.getAddress())
    })

    it('should prevent non-owner from setting contribution desk', async function () {
      await expect(pool.connect(other).setContributionDesk(await desk.getAddress()))
        .to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount')
    })

    it('should reject zero address for contribution desk', async function () {
      await expect(pool.setContributionDesk(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(pool, 'InvalidAddress')
    })
  })

  describe('Emergency Withdrawal', function () {
    beforeEach(async function () {
      await token.transfer(await pool.getAddress(), 1000n * decimalsMultiplier)
    })

    it('should allow owner to emergency withdraw', async function () {
      const balanceBefore = await token.balanceOf(other.address)
      
      await expect(pool.connect(owner).emergencyWithdraw(other.address, 500n * decimalsMultiplier))
        .to.emit(pool, 'Withdrawal')
        .withArgs(other.address, 500n * decimalsMultiplier, owner.address)

      expect(await pool.getBalance()).to.equal(500n * decimalsMultiplier)
      expect(await token.balanceOf(other.address) - balanceBefore).to.equal(500n * decimalsMultiplier)
    })

    it('should prevent non-owner from emergency withdrawal', async function () {
      await expect(pool.connect(other).emergencyWithdraw(contributor.address, 100n * decimalsMultiplier))
        .to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount')
    })

    it('should reject emergency withdrawal to zero address', async function () {
      await expect(pool.connect(owner).emergencyWithdraw(ethers.ZeroAddress, 100n * decimalsMultiplier))
        .to.be.revertedWithCustomError(pool, 'InvalidAddress')
    })
  })

  describe('Balance Queries', function () {
    it('should return correct balance after deposits', async function () {
      await token.transfer(await pool.getAddress(), 1000n * decimalsMultiplier)
      expect(await pool.getBalance()).to.equal(1000n * decimalsMultiplier)

      await token.transfer(await pool.getAddress(), 500n * decimalsMultiplier)
      expect(await pool.getBalance()).to.equal(1500n * decimalsMultiplier)
    })

    it('should return correct balance after withdrawals', async function () {
      await token.transfer(await pool.getAddress(), 1000n * decimalsMultiplier)
      await pool.setContributionDesk(await desk.getAddress())

      await pool.connect(owner).withdraw(contributor.address, 300n * decimalsMultiplier)
      expect(await pool.getBalance()).to.equal(700n * decimalsMultiplier)
    })
  })
})
