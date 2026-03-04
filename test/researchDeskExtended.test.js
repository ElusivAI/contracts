const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('ElusivResearchDesk extended', function () {
  let token
  let desk
  let owner
  let user
  const decimalsMultiplier = 10n ** 18n
  const initialCost = 10n * decimalsMultiplier

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('ElusivToken')
    token = await Token.deploy(owner.address)
    await token.waitForDeployment()
    await token.transfer(user.address, 1000n * decimalsMultiplier)
    const Desk = await ethers.getContractFactory('ElusivResearchDesk')
    desk = await Desk.deploy(await token.getAddress(), initialCost, 512)
    await desk.waitForDeployment()
  })

  describe('getRequests pagination', function () {
    it('getRequests(0, 5) with 10 requests returns first 5', async function () {
      await token.connect(user).approve(await desk.getAddress(), initialCost * 10n)
      for (let i = 0; i < 10; i++) {
        await desk.connect(user).requestResearch(`query ${i}`)
      }
      const page = await desk.getRequests(0, 5)
      expect(page.length).to.equal(5)
      expect(page[0].query).to.equal('query 0')
      expect(page[4].query).to.equal('query 4')
    })

    it('getRequests(8, 5) with 10 requests returns last 2', async function () {
      await token.connect(user).approve(await desk.getAddress(), initialCost * 10n)
      for (let i = 0; i < 10; i++) {
        await desk.connect(user).requestResearch(`query ${i}`)
      }
      const page = await desk.getRequests(8, 5)
      expect(page.length).to.equal(2)
      expect(page[0].query).to.equal('query 8')
      expect(page[1].query).to.equal('query 9')
    })

    it('getRequests(100, 5) with 10 requests returns empty array', async function () {
      await token.connect(user).approve(await desk.getAddress(), initialCost)
      await desk.connect(user).requestResearch('only one')
      const page = await desk.getRequests(100, 5)
      expect(page.length).to.equal(0)
    })

    it('getRequests(0, 100) with 10 requests returns all 10 (limit clamped)', async function () {
      await token.connect(user).approve(await desk.getAddress(), initialCost * 10n)
      for (let i = 0; i < 10; i++) {
        await desk.connect(user).requestResearch(`query ${i}`)
      }
      const page = await desk.getRequests(0, 100)
      expect(page.length).to.equal(10)
      expect(page[9].query).to.equal('query 9')
    })
  })

  describe('setRequestCost', function () {
    it('setRequestCost emits RequestCostUpdated and subsequent request uses new cost', async function () {
      const newCost = 20n * decimalsMultiplier
      await expect(desk.setRequestCost(newCost))
        .to.emit(desk, 'RequestCostUpdated')
        .withArgs(newCost, owner.address)
      expect(await desk.requestCost()).to.equal(newCost)

      await token.connect(user).approve(await desk.getAddress(), newCost)
      await expect(desk.connect(user).requestResearch('paid at new cost'))
        .to.emit(desk, 'RequestSubmitted')
        .withArgs(0, user.address, 'paid at new cost', newCost)
      const req = await desk.getRequest(0)
      expect(req.payment).to.equal(newCost)
    })
  })
})
