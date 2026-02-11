const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time } = require('@nomicfoundation/hardhat-network-helpers')

describe('ElusivContributionDesk', function () {
  let token, pool, desk
  let owner, contributor, validator1, validator2, validator3, validator4, validator5, other
  const decimalsMultiplier = 10n ** 18n
  const reviewPeriod = 7 * 24 * 60 * 60 // 7 days in seconds
  const minValidators = 3
  const maxValidators = 5

  beforeEach(async function () {
    [owner, contributor, validator1, validator2, validator3, validator4, validator5, other] = await ethers.getSigners()

    const Token = await ethers.getContractFactory('ElusivToken')
    token = await Token.deploy(owner.address)
    await token.waitForDeployment()

    const Pool = await ethers.getContractFactory('ElusivCommunityPool')
    pool = await Pool.deploy(await token.getAddress())
    await pool.waitForDeployment()

    const Desk = await ethers.getContractFactory('ElusivContributionDesk')
    desk = await Desk.deploy(
      await token.getAddress(),
      reviewPeriod,
      minValidators,
      maxValidators
    )
    await desk.waitForDeployment()

    await pool.setContributionDesk(await desk.getAddress())
    await desk.setCommunityPool(await pool.getAddress())

    await desk.addValidator(validator1.address)
    await desk.addValidator(validator2.address)
    await desk.addValidator(validator3.address)
    await desk.addValidator(validator4.address)
    await desk.addValidator(validator5.address)
  })

  describe('Deployment', function () {
    it('should deploy with correct initial values', async function () {
      expect(await desk.reviewPeriod()).to.equal(reviewPeriod)
      expect(await desk.minValidatorsRequired()).to.equal(minValidators)
      expect(await desk.maxValidators()).to.equal(maxValidators)
      expect(await desk.elusivToken()).to.equal(await token.getAddress())
    })

    it('should have validators added', async function () {
      const validators = await desk.getValidators()
      expect(validators).to.have.lengthOf(5)
      expect(await desk.validators(validator1.address)).to.equal(true)
      expect(await desk.validators(validator2.address)).to.equal(true)
    })
  })

  describe('Validator Management', function () {
    it('should allow owner to add validators', async function () {
      await expect(desk.addValidator(other.address))
        .to.emit(desk, 'ValidatorAdded')
        .withArgs(other.address)
      
      expect(await desk.validators(other.address)).to.equal(true)
      const validators = await desk.getValidators()
      expect(validators).to.have.lengthOf(6)
    })

    it('should allow owner to remove validators', async function () {
      await expect(desk.removeValidator(validator1.address))
        .to.emit(desk, 'ValidatorRemoved')
        .withArgs(validator1.address)
      
      expect(await desk.validators(validator1.address)).to.equal(false)
      const validators = await desk.getValidators()
      expect(validators).to.have.lengthOf(4)
    })

    it('should prevent non-owner from adding validators', async function () {
      await expect(desk.connect(other).addValidator(other.address))
        .to.be.revertedWithCustomError(desk, 'OwnableUnauthorizedAccount')
    })

    it('should prevent adding invalid address', async function () {
      await expect(desk.addValidator(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(desk, 'InvalidValidator')
    })

    it('should allow owner to update min validators required', async function () {
      await expect(desk.setMinValidatorsRequired(4))
        .to.emit(desk, 'MinValidatorsUpdated')
        .withArgs(4)
      
      expect(await desk.minValidatorsRequired()).to.equal(4)
    })

    it('should allow owner to update review period', async function () {
      const newPeriod = 14 * 24 * 60 * 60
      await expect(desk.setReviewPeriod(newPeriod))
        .to.emit(desk, 'ReviewPeriodUpdated')
        .withArgs(newPeriod)
      
      expect(await desk.reviewPeriod()).to.equal(newPeriod)
    })
  })

  describe('Contribution Submission', function () {
    it('should allow anyone to submit a contribution', async function () {
      const title = 'Quantum Computing Research'
      const documentHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const description = 'A comprehensive research paper on quantum computing'
      const rewardAmount = 100n * decimalsMultiplier

      await expect(desk.connect(contributor).submitContribution(title, documentHash, description, rewardAmount))
        .to.emit(desk, 'ContributionSubmitted')
        .withArgs(0, contributor.address, title, documentHash)

      const contrib = await desk.getContribution(0)
      expect(contrib.contributor).to.equal(contributor.address)
      expect(contrib.title).to.equal(title)
      expect(contrib.documentHash).to.equal(documentHash)
      expect(contrib.status).to.equal(1) // UnderReview
      expect(contrib.validators).to.have.lengthOf(maxValidators)
    })

    it('should reject empty title', async function () {
      await expect(desk.connect(contributor).submitContribution('', '0x1234', 'desc', 0))
        .to.be.revertedWith('Title required')
    })

    it('should reject title too long', async function () {
      const longTitle = 'a'.repeat(257)
      await expect(desk.connect(contributor).submitContribution(longTitle, '0x1234', 'desc', 0))
        .to.be.revertedWith('Title too long')
    })

    it('should reject empty document hash', async function () {
      await expect(desk.connect(contributor).submitContribution('Title', '', 'desc', 0))
        .to.be.revertedWith('Document hash required')
    })

    it('should reject description too long', async function () {
      const longDesc = 'a'.repeat(1025)
      await expect(desk.connect(contributor).submitContribution('Title', '0x1234', longDesc, 0))
        .to.be.revertedWith('Description too long')
    })

    it('should reject submission if insufficient validators', async function () {
      await desk.removeValidator(validator1.address)
      await desk.removeValidator(validator2.address)
      await desk.removeValidator(validator3.address)

      await expect(desk.connect(contributor).submitContribution('Title', '0x1234', 'desc', 0))
        .to.be.revertedWith('Insufficient validators')
    })

    it('should assign validators in round-robin fashion', async function () {
      await desk.connect(contributor).submitContribution('Title 1', '0x1111', 'desc', 0)
      await desk.connect(contributor).submitContribution('Title 2', '0x2222', 'desc', 0)

      const contrib1 = await desk.getContribution(0)
      const contrib2 = await desk.getContribution(1)

      expect(contrib1.validators[0]).to.equal(contrib2.validators[0])
    })
  })

  describe('Validator Voting', function () {
    beforeEach(async function () {
      await desk.connect(contributor).submitContribution(
        'Test Contribution',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        'Description',
        100n * decimalsMultiplier
      )
    })

    it('should allow assigned validators to vote', async function () {
      await expect(desk.connect(validator1).validatorVote(0, true))
        .to.emit(desk, 'ValidatorVoted')
        .withArgs(0, validator1.address, true)

      const contrib = await desk.getContribution(0)
      expect(contrib.approvalCount).to.equal(1)
      expect(contrib.rejectionCount).to.equal(0)
    })

    it('should allow validators to reject', async function () {
      await expect(desk.connect(validator1).validatorVote(0, false))
        .to.emit(desk, 'ValidatorVoted')
        .withArgs(0, validator1.address, false)

      const contrib = await desk.getContribution(0)
      expect(contrib.approvalCount).to.equal(0)
      expect(contrib.rejectionCount).to.equal(1)
    })

    it('should prevent non-validators from voting', async function () {
      await expect(desk.connect(other).validatorVote(0, true))
        .to.be.revertedWithCustomError(desk, 'NotValidator')
    })

    it('should prevent unassigned validators from voting', async function () {
      await desk.removeValidator(validator1.address)
      await desk.addValidator(other.address)

      await expect(desk.connect(other).validatorVote(0, true))
        .to.be.revertedWithCustomError(desk, 'NotValidator')
    })

    it('should prevent double voting', async function () {
      await desk.connect(validator1).validatorVote(0, true)
      await expect(desk.connect(validator1).validatorVote(0, false))
        .to.be.revertedWithCustomError(desk, 'AlreadyVoted')
    })

    it('should prevent voting on non-under-review contributions', async function () {
      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)
      await desk.connect(validator3).validatorVote(0, true)
      await time.increase(reviewPeriod + 1)
      await desk.finalizeContribution(0)

      await expect(desk.connect(validator4).validatorVote(0, true))
        .to.be.revertedWithCustomError(desk, 'ContributionNotUnderReview')
    })
  })

  describe('Contribution Finalization', function () {
    beforeEach(async function () {
      await token.transfer(await pool.getAddress(), 1000n * decimalsMultiplier)
      await desk.connect(contributor).submitContribution(
        'Test Contribution',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        'Description',
        100n * decimalsMultiplier
      )
    })

    it('should finalize and approve when consensus reached after deadline', async function () {
      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)
      await desk.connect(validator3).validatorVote(0, true)

      await time.increase(reviewPeriod + 1)

      const balanceBefore = await token.balanceOf(contributor.address)
      await expect(desk.finalizeContribution(0))
        .to.emit(desk, 'ContributionFinalized')
        .withArgs(0, true, 100n * decimalsMultiplier)
        .and.to.emit(desk, 'RewardDistributed')
        .withArgs(0, contributor.address, 100n * decimalsMultiplier)

      const contrib = await desk.getContribution(0)
      expect(contrib.status).to.equal(2) // Approved

      const balanceAfter = await token.balanceOf(contributor.address)
      expect(balanceAfter - balanceBefore).to.equal(100n * decimalsMultiplier)

      const stats = await desk.getContributorStats(contributor.address)
      expect(stats.totalValue).to.equal(100n * decimalsMultiplier)
    })

    it('should finalize and reject when consensus not reached', async function () {
      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, false)

      await time.increase(reviewPeriod + 1)

      await expect(desk.finalizeContribution(0))
        .to.emit(desk, 'ContributionFinalized')
        .withArgs(0, false, 100n * decimalsMultiplier)

      const contrib = await desk.getContribution(0)
      expect(contrib.status).to.equal(3) // Rejected
    })

    it('should prevent finalization before deadline', async function () {
      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)
      await desk.connect(validator3).validatorVote(0, true)

      await expect(desk.finalizeContribution(0))
        .to.be.revertedWithCustomError(desk, 'ReviewPeriodNotExpired')
    })

    it('should auto-finalize when consensus reached during voting', async function () {
      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)

      await time.increase(reviewPeriod + 1)

      const balanceBefore = await token.balanceOf(contributor.address)
      await expect(desk.connect(validator3).validatorVote(0, true))
        .to.emit(desk, 'ContributionFinalized')
        .withArgs(0, true, 100n * decimalsMultiplier)

      const contrib = await desk.getContribution(0)
      expect(contrib.status).to.equal(2) // Approved

      const balanceAfter = await token.balanceOf(contributor.address)
      expect(balanceAfter - balanceBefore).to.equal(100n * decimalsMultiplier)
    })

    it('should not distribute reward if pool has insufficient balance', async function () {
      const poolAddress = await pool.getAddress()
      const poolBalanceBefore = await token.balanceOf(poolAddress)
      
      const poolContract = await ethers.getContractAt('ElusivCommunityPool', poolAddress)
      await poolContract.connect(owner).withdraw(owner.address, poolBalanceBefore)
      
      const poolBalance = await token.balanceOf(poolAddress)
      expect(poolBalance).to.equal(0)

      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)
      await desk.connect(validator3).validatorVote(0, true)

      await time.increase(reviewPeriod + 1)

      await desk.finalizeContribution(0)

      const contrib = await desk.getContribution(0)
      expect(contrib.status).to.equal(2) // Approved

      const stats = await desk.getContributorStats(contributor.address)
      expect(stats.totalValue).to.equal(0)
      
      const contributorBalance = await token.balanceOf(contributor.address)
      expect(contributorBalance).to.equal(0)

      expect(await desk.isRewardClaimed(0)).to.equal(false)
      await token.transfer(await pool.getAddress(), 500n * decimalsMultiplier)
      await expect(desk.connect(other).claimReward(0)).to.be.revertedWithCustomError(desk, 'NotContributor')
      await expect(desk.connect(contributor).claimReward(0)).to.emit(desk, 'RewardDistributed').withArgs(0, contributor.address, 100n * decimalsMultiplier)
      expect(await desk.isRewardClaimed(0)).to.equal(true)
      expect(await token.balanceOf(contributor.address)).to.equal(100n * decimalsMultiplier)
      await expect(desk.connect(contributor).claimReward(0)).to.be.revertedWithCustomError(desk, 'RewardAlreadyClaimed')
    })
  })

  describe('Contributor Stats and Leaderboard', function () {
    beforeEach(async function () {
      await token.transfer(await pool.getAddress(), 5000n * decimalsMultiplier)
    })

    it('should track contributor stats', async function () {
      await desk.connect(contributor).submitContribution('Title 1', '0x1111', 'desc', 100n * decimalsMultiplier)
      await desk.connect(contributor).submitContribution('Title 2', '0x2222', 'desc', 200n * decimalsMultiplier)

      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)
      await desk.connect(validator3).validatorVote(0, true)

      await desk.connect(validator1).validatorVote(1, true)
      await desk.connect(validator2).validatorVote(1, true)
      await desk.connect(validator3).validatorVote(1, true)

      await time.increase(reviewPeriod + 1)

      await desk.finalizeContribution(0)
      await desk.finalizeContribution(1)

      const stats = await desk.getContributorStats(contributor.address)
      expect(stats.totalValue).to.equal(300n * decimalsMultiplier)
      expect(stats.contributionCount).to.equal(2)
    })

    it('should return top contributors', async function () {
      const [contributor2] = await ethers.getSigners()
      
      await desk.connect(contributor).submitContribution('Title 1', '0x1111', 'desc', 100n * decimalsMultiplier)
      await desk.connect(contributor2).submitContribution('Title 2', '0x2222', 'desc', 200n * decimalsMultiplier)

      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)
      await desk.connect(validator3).validatorVote(0, true)

      await desk.connect(validator1).validatorVote(1, true)
      await desk.connect(validator2).validatorVote(1, true)
      await desk.connect(validator3).validatorVote(1, true)

      await time.increase(reviewPeriod + 1)

      await desk.finalizeContribution(0)
      await desk.finalizeContribution(1)

      const topContributors = await desk.getTopContributors(10)
      expect(topContributors).to.have.lengthOf(2)
      expect(topContributors[0].contributor).to.equal(contributor2.address)
      expect(topContributors[0].totalValue).to.equal(200n * decimalsMultiplier)
      expect(topContributors[1].contributor).to.equal(contributor.address)
      expect(topContributors[1].totalValue).to.equal(100n * decimalsMultiplier)
    })
  })

  describe('Pagination', function () {
    beforeEach(async function () {
      await desk.connect(contributor).submitContribution('Title 1', '0x1111', 'desc', 0)
      await desk.connect(contributor).submitContribution('Title 2', '0x2222', 'desc', 0)
      await desk.connect(contributor).submitContribution('Title 3', '0x3333', 'desc', 0)
    })

    it('should return paginated contributions', async function () {
      const contributions = await desk.getContributions(0, 2)
      expect(contributions).to.have.lengthOf(2)
      expect(contributions[0].title).to.equal('Title 1')
      expect(contributions[1].title).to.equal('Title 2')
    })

    it('should handle offset beyond total', async function () {
      const contributions = await desk.getContributions(10, 5)
      expect(contributions).to.have.lengthOf(0)
    })

    it('should handle limit exceeding total', async function () {
      const contributions = await desk.getContributions(0, 10)
      expect(contributions).to.have.lengthOf(3)
    })

    it('should handle partial page at end', async function () {
      const contributions = await desk.getContributions(2, 5)
      expect(contributions).to.have.lengthOf(1)
      expect(contributions[0].title).to.equal('Title 3')
    })
  })

  describe('Pool Management', function () {
    it('should allow depositing to pool', async function () {
      await token.transfer(other.address, 1000n * decimalsMultiplier)
      await token.connect(other).approve(await desk.getAddress(), 500n * decimalsMultiplier)

      await desk.connect(other).depositToPool(500n * decimalsMultiplier)

      const poolBalance = await desk.getPoolBalance()
      expect(poolBalance).to.equal(500n * decimalsMultiplier)
    })

    it('should return pool balance', async function () {
      await token.transfer(await pool.getAddress(), 1000n * decimalsMultiplier)
      const balance = await desk.getPoolBalance()
      expect(balance).to.equal(1000n * decimalsMultiplier)
    })

    it('should return zero balance if pool not set', async function () {
      const Desk2 = await ethers.getContractFactory('ElusivContributionDesk')
      const desk2 = await Desk2.deploy(await token.getAddress(), reviewPeriod, minValidators, maxValidators)
      await desk2.waitForDeployment()

      const balance = await desk2.getPoolBalance()
      expect(balance).to.equal(0)
    })
  })

  describe('Validator Vote Timestamps', function () {
    beforeEach(async function () {
      await desk.connect(contributor).submitContribution('Title', '0x1234', 'desc', 0)
    })

    it('should track votedAt timestamp', async function () {
      const beforeVote = await ethers.provider.getBlock('latest')
      await desk.connect(validator1).validatorVote(0, true)
      const afterVote = await ethers.provider.getBlock('latest')

      const votes = await desk.getValidatorVotes(0)
      expect(votes[0].votedAt).to.be.gte(beforeVote.timestamp)
      expect(votes[0].votedAt).to.be.lte(afterVote.timestamp)
      expect(votes[0].vote).to.equal(1) // Approve
    })

    it('should return zero timestamp for validators who have not voted', async function () {
      await desk.connect(validator1).validatorVote(0, true)

      const votes = await desk.getValidatorVotes(0)
      expect(votes[0].votedAt).to.be.gt(0)
      expect(votes[1].votedAt).to.equal(0)
      expect(votes[1].vote).to.equal(0) // None
    })
  })

  describe('Edge Cases', function () {
    it('should handle contribution with zero reward', async function () {
      await desk.connect(contributor).submitContribution('Title', '0x1234', 'desc', 0)

      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)
      await desk.connect(validator3).validatorVote(0, true)

      await time.increase(reviewPeriod + 1)

      await desk.finalizeContribution(0)

      const contrib = await desk.getContribution(0)
      expect(contrib.status).to.equal(2) // Approved

      const stats = await desk.getContributorStats(contributor.address)
      expect(stats.totalValue).to.equal(0)
    })

    it('should prevent finalizing already finalized contribution', async function () {
      await desk.connect(contributor).submitContribution('Title', '0x1234', 'desc', 0)

      await desk.connect(validator1).validatorVote(0, true)
      await desk.connect(validator2).validatorVote(0, true)
      await desk.connect(validator3).validatorVote(0, true)

      await time.increase(reviewPeriod + 1)

      await desk.finalizeContribution(0)
      await expect(desk.finalizeContribution(0))
        .to.be.revertedWithCustomError(desk, 'ContributionNotUnderReview')
    })
  })
})
