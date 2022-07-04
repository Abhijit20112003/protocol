import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, BigNumberish } from 'ethers'
import { fp, bn } from '../../common/numbers'
import { PriceModelKind, PriceModel } from './common'
import * as sc from '../../typechain' // All smart contract types

describe(`AssetMock`, () => {
  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  let token: sc.ERC20Mock

  async function newAsset(priceModel: PriceModel): Promise<sc.AssetMock> {
    const f: sc.AssetMock__factory = await ethers.getContractFactory('AssetMock')
    return await f.deploy(token.address, fp(1e6), priceModel)
  }

  beforeEach(async () => {
    ;[owner, alice, bob, carol] = await ethers.getSigners()
    {
      const f: sc.ERC20Mock__factory = await ethers.getContractFactory('ERC20Mock')
      token = await f.deploy('ERC20Mock Token', 'MT')
    }
  })

  it('does not change prices in CONSTANT mode', async () => {
    const asset: sc.AssetMock = await newAsset({
      kind: PriceModelKind.CONSTANT,
      curr: fp(1.02),
      low: fp(0.9),
      high: fp(1.1),
    })
    expect(await asset.price()).to.equal(fp(1.02))
    await asset.update(fp(0.99))
    expect(await asset.price()).to.equal(fp(1.02))
    await asset.update(0)
    expect(await asset.price()).to.equal(fp(1.02))
  })

  it('sets prices as expected in MANUAL mode', async () => {
    const asset: sc.AssetMock = await newAsset({
      kind: PriceModelKind.MANUAL,
      curr: fp(1.02),
      low: fp(0.9),
      high: fp(1.1),
    })
    expect(await asset.price()).to.equal(fp(1.02))
    await asset.update(fp(0.99))
    expect(await asset.price()).to.equal(fp(0.99))
    await asset.update(fp(1.3))
    expect(await asset.price()).to.equal(fp(1.3))
    await asset.update(0)
    expect(await asset.price()).to.equal(0)

    const big: BigNumber = BigNumber.from(2n ** 192n - 1n) // max uint192
    await asset.update(big)
    expect(await asset.price()).to.equal(big)
  })

  it('sets arbitrary in-band prices in BAND mode', async () => {
    const asset: sc.AssetMock = await newAsset({
      kind: PriceModelKind.BAND,
      curr: fp(1.02),
      low: fp(0.9),
      high: fp(1.1),
    })
    expect(await asset.price()).to.equal(fp(1.02))

    await asset.update(0) // hit low; implementation-sensitive
    expect(await asset.price()).to.equal(fp(0.9))

    await asset.update(fp(0.2)) // hit high; implementation-sensitive
    expect(await asset.price()).to.equal(fp(1.1))

    await asset.update(fp(98643.8623))
    let p = await asset.price()
    expect(p.gte(fp(0.9))).to.be.true
    expect(p.lte(fp(1.1))).to.be.true
  })

  it('changes by arbitrary multiplications in WALK mode', async () => {
    const asset: sc.AssetMock = await newAsset({
      kind: PriceModelKind.WALK,
      curr: fp(1),
      low: fp(0.5),
      high: fp(2),
    })
    expect(await asset.price()).to.equal(fp(1))

    await asset.update(0) // hit low; implementation-sensitive
    expect(await asset.price()).to.equal(fp(0.5))

    await asset.update(fp(1.5)) // hit high; implementation-sensitive
    await asset.update(fp(1.5)) // hit high; implementation-sensitive
    expect(await asset.price()).to.equal(fp(2))

    await asset.update(fp(98643.8623))
    let p = await asset.price()
    expect(p.gte(fp(1))).to.be.true
    expect(p.lte(fp(4))).to.be.true
  })
})
