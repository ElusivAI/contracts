const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('Elusiv suite', function () {
  it('deploys ELUSIV token and access pass', async function () {
    const [owner, user] = await ethers.getSigners()

    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const supply = await token.INITIAL_SUPPLY()
    expect(await token.balanceOf(owner.address)).to.equal(supply)
    await token.transfer(user.address, 100n)
    expect(await token.balanceOf(user.address)).to.equal(100n)
    expect(await token.name()).to.equal('Elusiv Token')
    expect(await token.symbol()).to.equal('ELUSIV')

    const Pass = await ethers.getContractFactory('ElusivAccessPass')
    const mintPrice = ethers.parseEther('0.01')
    const pass = await Pass.deploy(2n, true, mintPrice, owner.address)
    await pass.waitForDeployment()
    await pass.connect(user).getFunction('publicMint()')({ value: mintPrice })
    expect(await pass.balanceOf(user.address)).to.equal(1n)
    expect(await pass.creator()).to.equal('Elusiv Labs')
  })

  it('enforces minting rules on the access pass', async function () {
    const [owner, user, other] = await ethers.getSigners()
    const Pass = await ethers.getContractFactory('ElusivAccessPass')
    const mintPrice = ethers.parseEther('0.02')
    const pass = await Pass.deploy(2n, true, mintPrice, owner.address)
    await pass.waitForDeployment()

    await pass.connect(user).getFunction('publicMint()')({ value: mintPrice })
    await expect(pass.connect(user).getFunction('publicMint()')({ value: mintPrice })).to.be.revertedWithCustomError(pass, 'MintLimitReached')

    await pass.setMaxSupply(3n)
    await pass.setMintingEnabled(false)
    await expect(pass.connect(other).getFunction('publicMint()')({ value: mintPrice })).to.be.revertedWithCustomError(pass, 'MintClosed')

    await pass.mint(owner.address)
    expect(await pass.balanceOf(owner.address)).to.equal(1n)

    await pass.setMintingEnabled(true)
    await pass.connect(other).getFunction('publicMint()')({ value: mintPrice })
    expect(await pass.nextTokenId()).to.equal(3n)
  })

  it('handles research requests paid in ELUSIV tokens', async function () {
    const [owner, user] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(user.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const maxQuery = 256
    const desk = await Desk.deploy(await token.getAddress(), cost, maxQuery)
    await desk.waitForDeployment()

    await expect(desk.connect(user).requestResearch('')).to.be.revertedWith('Query required')
    const tooLong = 'a'.repeat(maxQuery + 1)
    await token.connect(user).approve(await desk.getAddress(), cost * 2n)
    await expect(desk.connect(user).requestResearch(tooLong)).to.be.revertedWith('Query too long')

    await expect(desk.connect(user).requestResearch('Map rare earth supply chains'))
      .to.emit(desk, 'RequestSubmitted')
      .withArgs(0, user.address, 'Map rare earth supply chains', cost)

    const pending = await desk.getPendingRequests()
    expect(pending).to.have.lengthOf(1)
    expect(pending[0].requester).to.equal(user.address)

    const myPending = await desk.getPendingRequestsFor(user.address)
    expect(myPending).to.have.lengthOf(1)
    expect(myPending[0].query).to.equal('Map rare earth supply chains')
    await expect(desk.getPendingRequestsFor(ethers.ZeroAddress)).to.be.revertedWithCustomError(desk, 'InvalidRequester')

    await expect(desk.connect(user).completeRequest(0, 'nope')).to.be.revertedWithCustomError(desk, 'OwnableUnauthorizedAccount')

    await expect(desk.completeRequest(0, 'Delivered summary')).to.emit(desk, 'RequestCompleted')
    const request = await desk.getRequest(0)
    expect(request.fulfilled).to.equal(true)
    expect(request.response).to.equal('Delivered summary')

    await expect(desk.withdraw(owner.address, cost))
      .to.emit(desk, 'FundsWithdrawn')
      .withArgs(owner.address, cost)
  })

  it('restricts owner withdraw to non-reserved balance', async function () {
    const [owner, user] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(user.address, 1_000n * decimalsMultiplier)
    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()
    await token.connect(user).approve(await desk.getAddress(), cost)
    await desk.connect(user).requestResearch('Open request')
    expect(await desk.reservedBalance()).to.equal(cost)
    await expect(desk.withdraw(owner.address, cost)).to.be.revertedWithCustomError(desk, 'ExceedsWithdrawable')
    await expect(desk.withdraw(owner.address, 1n)).to.be.revertedWithCustomError(desk, 'ExceedsWithdrawable')
    await desk.completeRequest(0, 'Done')
    expect(await desk.reservedBalance()).to.equal(0)
    await expect(desk.withdraw(owner.address, cost)).to.emit(desk, 'FundsWithdrawn').withArgs(owner.address, cost)
  })

  it('allows users to submit completions for research requests', async function () {
    const [owner, requester, resolver] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester).approve(await desk.getAddress(), cost)
    await desk.connect(requester).requestResearch('Research quantum computing applications')
    
    const documentHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    
    await expect(desk.connect(resolver).submitCompletion(0, documentHash))
      .to.emit(desk, 'CompletionSubmitted')
      .withArgs(0, resolver.address, documentHash)

    const request = await desk.getRequest(0)
    expect(request.resolver).to.equal(resolver.address)
    expect(request.documentHash).to.equal(documentHash)
    expect(request.pendingApproval).to.equal(true)
    expect(request.fulfilled).to.equal(false)
    expect(request.submittedAt).to.be.gt(0)
  })

  it('allows requester to approve completion and transfer tokens', async function () {
    const [owner, requester, resolver] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester).approve(await desk.getAddress(), cost)
    await desk.connect(requester).requestResearch('Research quantum computing')
    
    const resolverBalanceBefore = await token.balanceOf(resolver.address)
    const documentHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    
    await desk.connect(resolver).submitCompletion(0, documentHash)
    
    await expect(desk.connect(requester).approveCompletion(0))
      .to.emit(desk, 'CompletionApproved')
      .withArgs(0, resolver.address, cost)
      .and.to.emit(desk, 'RequestCompleted')
      .withArgs(0, documentHash, resolver.address)

    const request = await desk.getRequest(0)
    expect(request.fulfilled).to.equal(true)
    expect(request.pendingApproval).to.equal(false)
    expect(request.response).to.equal(documentHash)
    
    const resolverBalanceAfter = await token.balanceOf(resolver.address)
    expect(resolverBalanceAfter - resolverBalanceBefore).to.equal(cost)
    
    const pending = await desk.getPendingRequests()
    expect(pending).to.have.lengthOf(0)
  })

  it('allows requester to reject completion', async function () {
    const [owner, requester, resolver] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester).approve(await desk.getAddress(), cost)
    await desk.connect(requester).requestResearch('Research topic')
    
    const documentHash = '0x1111111111111111111111111111111111111111111111111111111111111111'
    await desk.connect(resolver).submitCompletion(0, documentHash)
    
    await expect(desk.connect(requester).rejectCompletion(0))
      .to.emit(desk, 'CompletionRejected')
      .withArgs(0, requester.address)

    const request = await desk.getRequest(0)
    expect(request.fulfilled).to.equal(false)
    expect(request.pendingApproval).to.equal(false)
    expect(request.resolver).to.equal(ethers.ZeroAddress)
    expect(request.documentHash).to.equal('')
    expect(request.submittedAt).to.equal(0)
    
    const pending = await desk.getPendingRequests()
    expect(pending).to.have.lengthOf(1)
  })

  it('prevents non-requester from approving completion', async function () {
    const [owner, requester, resolver, other] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester).approve(await desk.getAddress(), cost)
    await desk.connect(requester).requestResearch('Research topic')
    
    await desk.connect(resolver).submitCompletion(0, '0x1234')
    
    await expect(desk.connect(other).approveCompletion(0))
      .to.be.revertedWithCustomError(desk, 'NotRequester')
    
    await expect(desk.connect(resolver).approveCompletion(0))
      .to.be.revertedWithCustomError(desk, 'NotRequester')
  })

  it('prevents non-requester from rejecting completion', async function () {
    const [owner, requester, resolver, other] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester).approve(await desk.getAddress(), cost)
    await desk.connect(requester).requestResearch('Research topic')
    
    await desk.connect(resolver).submitCompletion(0, '0x1234')
    
    await expect(desk.connect(other).rejectCompletion(0))
      .to.be.revertedWithCustomError(desk, 'NotRequester')
  })

  it('prevents submitting completion for fulfilled request', async function () {
    const [owner, requester, resolver] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester).approve(await desk.getAddress(), cost)
    await desk.connect(requester).requestResearch('Research topic')
    
    await desk.connect(resolver).submitCompletion(0, '0x1234')
    await desk.connect(requester).approveCompletion(0)
    
    await expect(desk.connect(resolver).submitCompletion(0, '0x5678'))
      .to.be.revertedWithCustomError(desk, 'AlreadyFulfilled')
  })

  it('prevents submitting completion when one is already pending', async function () {
    const [owner, requester, resolver1, resolver2] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester).approve(await desk.getAddress(), cost)
    await desk.connect(requester).requestResearch('Research topic')
    
    await desk.connect(resolver1).submitCompletion(0, '0x1111')
    
    await expect(desk.connect(resolver2).submitCompletion(0, '0x2222'))
      .to.be.revertedWithCustomError(desk, 'CompletionAlreadyPending')
  })

  it('allows new completion after rejection', async function () {
    const [owner, requester, resolver1, resolver2] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester).approve(await desk.getAddress(), cost)
    await desk.connect(requester).requestResearch('Research topic')
    
    await desk.connect(resolver1).submitCompletion(0, '0x1111')
    await desk.connect(requester).rejectCompletion(0)
    
    await expect(desk.connect(resolver2).submitCompletion(0, '0x2222'))
      .to.emit(desk, 'CompletionSubmitted')
      .withArgs(0, resolver2.address, '0x2222')
    
    const request = await desk.getRequest(0)
    expect(request.resolver).to.equal(resolver2.address)
    expect(request.documentHash).to.equal('0x2222')
    expect(request.pendingApproval).to.equal(true)
  })

  it('returns pending approvals for requester', async function () {
    const [owner, requester1, requester2, resolver] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    const token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    const decimalsMultiplier = 10n ** 18n
    await token.transfer(requester1.address, 1_000n * decimalsMultiplier)
    await token.transfer(requester2.address, 1_000n * decimalsMultiplier)

    const cost = 25n * decimalsMultiplier
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const desk = await Desk.deploy(await token.getAddress(), cost, 256)
    await desk.waitForDeployment()

    await token.connect(requester1).approve(await desk.getAddress(), cost * 2n)
    await token.connect(requester2).approve(await desk.getAddress(), cost)
    
    await desk.connect(requester1).requestResearch('Request 1')
    await desk.connect(requester1).requestResearch('Request 2')
    await desk.connect(requester2).requestResearch('Request 3')
    
    await desk.connect(resolver).submitCompletion(0, '0x1111')
    await desk.connect(resolver).submitCompletion(1, '0x2222')
    
    const pendingApprovals1 = await desk.getPendingApprovals(requester1.address)
    expect(pendingApprovals1).to.have.lengthOf(2)
    expect(pendingApprovals1[0].query).to.equal('Request 1')
    expect(pendingApprovals1[1].query).to.equal('Request 2')
    
    const pendingApprovals2 = await desk.getPendingApprovals(requester2.address)
    expect(pendingApprovals2).to.have.lengthOf(0)
    
    await desk.connect(requester1).approveCompletion(0)
    
    const pendingApprovals1After = await desk.getPendingApprovals(requester1.address)
    expect(pendingApprovals1After).to.have.lengthOf(1)
    expect(pendingApprovals1After[0].query).to.equal('Request 2')
  })

  it('prevents reentrancy during access pass publicMint', async function () {
    const [owner] = await ethers.getSigners()
    const Pass = await ethers.getContractFactory('ElusivAccessPass')
    const mintPrice = ethers.parseEther('0.03')
    const pass = await Pass.deploy(5n, true, mintPrice, owner.address)
    await pass.waitForDeployment()

    const ReenteringTreasury = await ethers.getContractFactory('ReenteringTreasury')
    const maliciousTreasury = await ReenteringTreasury.deploy(await pass.getAddress())
    await maliciousTreasury.waitForDeployment()

    await pass.setTreasury(maliciousTreasury.getAddress())
    // Reentrancy attempt causes the inner call to revert, bubbling as a failed treasury transfer
    await expect(pass.getFunction('publicMint()')({ value: mintPrice })).to.be.revertedWith('Treasury transfer failed')
    expect(await pass.nextTokenId()).to.equal(0n)
  })

  it('prevents reentrancy during research request payment', async function () {
    const [owner, user] = await ethers.getSigners()

    const Token = await ethers.getContractFactory('ReenteringToken')
    const token = await Token.deploy()
    await token.waitForDeployment()
    await token.mint(user.address, ethers.parseUnits('1000', 18))

    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    const cost = ethers.parseUnits('10', 18)
    const desk = await Desk.deploy(await token.getAddress(), cost, 128)
    await desk.waitForDeployment()

    await token.configure(await desk.getAddress(), 'r')
    await token.connect(user).approve(await desk.getAddress(), cost)

    await expect(desk.connect(user).requestResearch('hello')).to.be.revertedWithCustomError(
      desk,
      'ReentrancyGuardReentrantCall'
    )
    expect(await desk.totalRequests()).to.equal(0n)
  })
})

