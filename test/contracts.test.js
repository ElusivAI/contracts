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
    await pass.connect(user).publicMint({ value: mintPrice })
    expect(await pass.balanceOf(user.address)).to.equal(1n)
    expect(await pass.creator()).to.equal('Elusiv Labs')
  })

  it('enforces minting rules on the access pass', async function () {
    const [owner, user, other] = await ethers.getSigners()
    const Pass = await ethers.getContractFactory('ElusivAccessPass')
    const mintPrice = ethers.parseEther('0.02')
    const pass = await Pass.deploy(2n, true, mintPrice, owner.address)
    await pass.waitForDeployment()

    await pass.connect(user).publicMint({ value: mintPrice })
    await expect(pass.connect(user).publicMint({ value: mintPrice })).to.be.revertedWithCustomError(pass, 'MintLimitReached')

    await pass.setMaxSupply(3n)
    await pass.setMintingEnabled(false)
    await expect(pass.connect(other).publicMint({ value: mintPrice })).to.be.revertedWithCustomError(pass, 'MintClosed')

    await pass.mint(owner.address)
    expect(await pass.balanceOf(owner.address)).to.equal(1n)

    await pass.setMintingEnabled(true)
    await pass.connect(other).publicMint({ value: mintPrice })
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
    await expect(pass.publicMint({ value: mintPrice })).to.be.revertedWith('Treasury transfer failed')
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

