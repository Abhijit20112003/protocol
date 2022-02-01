import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { AuctionStatus, FURNACE_DEST, STRSR_DEST, BN_SCALE_FACTOR } from '../../common/constants'
import { bn, fp, divCeil } from '../../common/numbers'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracle } from '../../typechain/AaveOracle'
import { AssetP0 } from '../../typechain/AssetP0'
import { ATokenCollateralP0 } from '../../typechain/ATokenCollateralP0'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { CompoundOracle } from '../../typechain/CompoundOracle'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenCollateralP0 } from '../../typechain/CTokenCollateralP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { MainP0 } from '../../typechain/MainP0'
import { MarketMock } from '../../typechain/MarketMock'
import { RevenueTraderP0 } from '../../typechain/RevenueTraderP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { TraderP0 } from '../../typechain/TraderP0'
import { USDCMock } from '../../typechain/USDCMock'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig, IRevenueShare } from './utils/fixtures'

interface IAuctionInfo {
  sell: string
  buy: string
  sellAmount: BigNumber
  minBuyAmount: BigNumber
  startTime: number
  endTime: number
  clearingSellAmount: BigNumber
  clearingBuyAmount: BigNumber
  externalAuctionId: BigNumber
  status: AuctionStatus
}

const createFixtureLoader = waffle.createFixtureLoader

describe('MainP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: AssetP0
  let compAsset: AssetP0
  let compoundMock: ComptrollerMockP0
  let compoundOracle: CompoundOracle
  let aaveToken: ERC20Mock
  let aaveAsset: AssetP0
  let aaveMock: AaveLendingPoolMockP0
  let aaveOracle: AaveOracle

  // Trading
  let market: MarketMock
  let rsrTrader: RevenueTraderP0
  let rTokenTrader: RevenueTraderP0

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: CollateralP0
  let collateral1: CollateralP0
  let collateral2: ATokenCollateralP0
  let collateral3: CTokenCollateralP0
  let basketTargetAmts: BigNumber[]

  // Config values
  let config: IConfig
  let dist: IRevenueShare

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let rTokenAsset: RTokenAssetP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  const expectAuctionInfo = async (
    trader: TraderP0,
    index: number,
    auctionInfo: Partial<IAuctionInfo>
  ) => {
    const {
      sell,
      buy,
      sellAmount,
      minBuyAmount,
      startTime,
      endTime,
      clearingSellAmount,
      clearingBuyAmount,
      externalAuctionId,
      status,
    } = await trader.auctions(index)
    expect(sell).to.equal(auctionInfo.sell)
    expect(buy).to.equal(auctionInfo.buy)
    expect(sellAmount).to.equal(auctionInfo.sellAmount)
    expect(minBuyAmount).to.equal(auctionInfo.minBuyAmount)
    expect(startTime).to.equal(auctionInfo.startTime)
    expect(endTime).to.equal(auctionInfo.endTime)
    expect(clearingSellAmount).to.equal(auctionInfo.clearingSellAmount)
    expect(clearingBuyAmount).to.equal(auctionInfo.clearingBuyAmount)
    expect(externalAuctionId).to.equal(auctionInfo.externalAuctionId)
    expect(status).to.equal(auctionInfo.status)
  }

  const expectAuctionStatus = async (
    trader: TraderP0,
    index: number,
    expectedStatus: AuctionStatus
  ) => {
    const { status } = await trader.auctions(index)
    expect(status).to.equal(expectedStatus)
  }

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    let erc20s: ERC20Mock[]
    let basket: Collateral[]

      // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      aaveToken,
      compAsset,
      aaveAsset,
      compoundOracle,
      aaveOracle,
      compoundMock,
      aaveMock,
      erc20s,
      collateral,
      basket,
      basketTargetAmts,
      config,
      deployer,
      dist,
      main,
      rToken,
      rTokenAsset,
      furnace,
      stRSR,
      market,
    } = await loadFixture(defaultFixture))
    token0 = erc20s[collateral.indexOf(basket[0])]
    token1 = erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    // Set Aave revenue token
    await token2.setAaveToken(aaveToken.address)

    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = <ATokenCollateralP0>basket[2]
    collateral3 = <CTokenCollateralP0>basket[3]

    rsrTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rsrTrader())
    )
    rTokenTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rTokenTrader())
    )

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)
  })

  describe('Revenues', function () {
    context('With issued Rtokens', async function () {
      let issueAmount: BigNumber
      let rewardAmountCOMP: BigNumber
      let rewardAmountAAVE: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Provide approvals
        await token0.connect(addr1).approve(main.address, initialBal)
        await token1.connect(addr1).approve(main.address, initialBal)
        await token2.connect(addr1).approve(main.address, initialBal)
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Process issuance
        await main.poke()

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should claim COMP and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // COMP Rewards
        await compoundMock.setRewards(main.address, rewardAmountCOMP)

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountCOMP.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke()).to.emit(main, 'RewardsClaimed').withArgs(rewardAmountCOMP, 0)

        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Advance time till auctioo ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check previous auctions closed
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          externalAuctionId: bn('0'),
          status: AuctionStatus.DONE,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          externalAuctionId: bn('1'),
          status: AuctionStatus.DONE,
        })
      })

      it('Should claim AAVE and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(main.address, rewardAmountAAVE)

        // Collect revenue - Called via poke
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountAAVE.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke()).to.emit(main, 'RewardsClaimed').withArgs(0, rewardAmountAAVE)

        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, aaveAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: aaveAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // AAVE -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Advance time till auctioo ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)
      })

      it('Should handle large auctions for using maxAuctionSize with f=1 (RSR only)', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 1
        await main
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('2e18')

        // COMP Rewards
        await compoundMock.setRewards(main.address, rewardAmountCOMP)

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR = 1 to 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expect(main.poke()).to.emit(main, 'RewardsClaimed').withArgs(rewardAmountCOMP, 0)

        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auction registered
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Another call will create a new auction
        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rsrTrader, 'AuctionEnded')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 1, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check existing auctions still open
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.OPEN)

        // Perform Mock Bids for RSR (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Close auctions
        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check existing auctions are closed
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rsrTrader, 1, AuctionStatus.DONE)
      })

      it('Should handle large auctions for using maxAuctionSize with f=0 (RToken only)', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 0
        await main.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1.5e18')

        // AAVE Rewards
        await token2.setRewards(main.address, rewardAmountAAVE)

        // Collect revenue - Called via poke
        // Expected values based on Prices between AAVE and RToken = 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expect(main.poke()).to.emit(main, 'RewardsClaimed').withArgs(0, rewardAmountAAVE)

        await expect(main.poke())
          .to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auction registered
        // AAVE -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Perform Mock Bids for RToken (addr1 has balance)
        await rToken.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Calculate pending amount
        let sellAmtRemainder: BigNumber = rewardAmountAAVE.sub(sellAmt)
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        // Another call will create a new auction and close existing
        await expect(main.poke())
          .to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(1, aaveAsset.address, rTokenAsset.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')

        // AAVE -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 1, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check previous auction is closed
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)

        // Perform Mock Bids for RToken (addr1 has balance)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRemainder)
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Close auction
        await expect(main.poke())
          .to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(1, aaveAsset.address, rTokenAsset.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')
          .and.to.not.emit(rsrTrader, 'AuctionStarted')

        // Check existing auctions are closed
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 1, AuctionStatus.DONE)
      })

      it('Should handle large auctions using maxAuctionSize with revenue split RSR/RToken', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 0.8 (0.2 for Rtoken)
        await main
          .connect(owner)
          .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: fp('0.8') })
        await main
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: fp('0.2'), rsrDist: bn(0) })

        // Set COMP tokens as reward
        // Based on current f -> 1.6e18 to RSR and 0.4e18 to Rtoken
        rewardAmountCOMP = bn('2e18')

        // COMP Rewards
        await compoundMock.setRewards(main.address, rewardAmountCOMP)

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountCOMP.mul(20).div(100) // All Rtokens can be sold - 20% of total comp based on f
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke()).to.emit(main, 'RewardsClaimed').withArgs(rewardAmountCOMP, 0)

        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auctions registered
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        // Calculate pending amount
        let sellAmtRemainder: BigNumber = rewardAmountCOMP.sub(sellAmt).sub(sellAmtRToken)
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check previous auctions closed
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          externalAuctionId: bn('0'),
          status: AuctionStatus.DONE,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          externalAuctionId: bn('1'),
          status: AuctionStatus.DONE,
        })

        await expectAuctionInfo(rsrTrader, 1, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('2'),
          status: AuctionStatus.OPEN,
        })

        // Run final auction until all funds are converted
        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmtRemainder)
        await market.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        await expect(main.poke())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check all auctions are closed
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rsrTrader, 1, AuctionStatus.DONE)
      })
    })

    // context('With simple basket of ATokens and CTokens', async function () {
    //     let issueAmount: BigNumber

    //     beforeEach(async function () {
    //       issueAmount = bn('100e18')

    //       // Setup new basket with ATokens and CTokens
    //       await main.connect(owner).setPrimeBasket([collateral2.address, collateral3.address], [fp('0.5'), fp('0.5')])
    //       await main.connect(owner).switchBasket()

    //       // Provide approvals
    //       await token2.connect(addr1).approve(main.address, initialBal)
    //       await token3.connect(addr1).approve(main.address, initialBal)

    //       // Issue rTokens
    //       await main.connect(addr1).issue(issueAmount)

    //       // Process the issuance
    //       await main.poke()

    //       // Mint some RSR
    //       await rsr.connect(owner).mint(addr1.address, initialBal)
    //     })

    //     it.skip('Should mint RTokens when collateral appreciates and handle revenue auction correctly', async () => {
    //          // Advance time to get next reward
    //          await advanceTime(config.rewardPeriod.toString())

    //          // Get RToken Asset
    //          const rTokenAsset = <RTokenAssetP0>(
    //            await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
    //          )

    //          // Change redemption rate for AToken and CToken to double
    //          await token2.setExchangeRate(fp('2'))
    //          await token3.setExchangeRate(fp('2'))

    //          // f = fp(0.6) = 40% increase in price of RToken -> (1 + 0.4) / 2 = 7/10
    //          let b = fp(1)
    //            .add(bn(2 - 1).mul(fp(1).sub(dist.rsrDist)))
    //            .div(bn(2))

    //          // Check base factor
    //         //expect(await main.toBUs(bn('1e18'))).to.equal(b)

    //          // Total value being auctioned = sellAmount * new price (1.4) - This is the exact amount of RSR required (because RSR = 1 USD )
    //          let currentTotalSupply: BigNumber = await rToken.totalSupply()
    //          let newTotalSupply: BigNumber = fp(currentTotalSupply).div(b)

    //          let sellAmt: BigNumber = divCeil(newTotalSupply, bn(100)) // due to max auction size of 1% - rounding logic included
    //          let tempValueSell = sellAmt.mul(14)

    //          let minBuyAmtRSR: BigNumber = tempValueSell.sub(
    //            tempValueSell.mul(config.maxTradeSlippage).div(BN_SCALE_FACTOR)
    //          ) // due to trade slippage 1%
    //          minBuyAmtRSR = divCeil(minBuyAmtRSR, bn(10))

    //          // Call Poke to collect revenue and mint new tokens
    //          await main.poke()

    //          await expect(main.poke())
    //            .to.emit(rsrTrader, 'AuctionStarted')
    //          //  .withArgs(0, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR)

    //          const auctionTimestamp: number = await getLatestBlockTimestamp()

    //          // Check auctions registered
    //          // RToken -> RSR Auction
    //          await expectAuctionInfo(rsrTrader, 0, {
    //            sell: rTokenAsset.address,
    //            buy: rsrAsset.address,
    //            sellAmount: sellAmt,
    //            minBuyAmount: minBuyAmtRSR,
    //            startTime: auctionTimestamp,
    //            endTime: auctionTimestamp + Number(config.auctionPeriod),
    //            clearingSellAmount: bn('0'),
    //            clearingBuyAmount: bn('0'),
    //            externalAuctionId: bn('0'),
    //            status: AuctionStatus.OPEN,
    //          })

    //          // Perform Mock Bids for RSR(addr1 has balance)
    //          await rsr.connect(addr1).approve(market.address, minBuyAmtRSR)
    //          await market.placeBid(0, {
    //            bidder: addr1.address,
    //            sellAmount: sellAmt,
    //            buyAmount: minBuyAmtRSR,
    //          })

    //          // Advance time till auctioo ended
    //          await advanceTime(config.auctionPeriod.add(100).toString())

    //          // Call poke to end current auction, should start a new one with same amount
    //          await expect(main.poke())
    //            .to.emit(rsrTrader, 'AuctionEnded')
    //            //.withArgs(0, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR)
    //            .and.to.emit(rsrTrader, 'AuctionStarted')
    //            .withArgs(1, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR)

    //          // Check new auction
    //          await expectAuctionInfo(rsrTrader, 1, {
    //            sell: rTokenAsset.address,
    //            buy: rsrAsset.address,
    //            sellAmount: sellAmt,
    //            minBuyAmount: minBuyAmtRSR,
    //            startTime: await getLatestBlockTimestamp(),
    //            endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
    //            clearingSellAmount: bn('0'),
    //            clearingBuyAmount: bn('0'),
    //            externalAuctionId: bn('1'),
    //            status: AuctionStatus.OPEN,
    //     })
    //    })
    // })
  })
})