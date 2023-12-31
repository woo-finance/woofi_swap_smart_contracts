/*

░██╗░░░░░░░██╗░█████╗░░█████╗░░░░░░░███████╗██╗
░██║░░██╗░░██║██╔══██╗██╔══██╗░░░░░░██╔════╝██║
░╚██╗████╗██╔╝██║░░██║██║░░██║█████╗█████╗░░██║
░░████╔═████║░██║░░██║██║░░██║╚════╝██╔══╝░░██║
░░╚██╔╝░╚██╔╝░╚█████╔╝╚█████╔╝░░░░░░██║░░░░░██║
░░░╚═╝░░░╚═╝░░░╚════╝░░╚════╝░░░░░░░╚═╝░░░░░╚═╝

*
* MIT License
* ===========
*
* Copyright (c) 2020 WooTrade
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { expect, use } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { deployContract, solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { WooStakingVault, TestToken, WooAccessManager } from '../typechain'
import WooStakingVaultArtifact from '../artifacts/contracts/WooStakingVault.sol/WooStakingVault.json'
import TestTokenArtifact from '../artifacts/contracts/test/TestErc20Token.sol/TestToken.json'
import WooAccessManagerArtifact from '../artifacts/contracts/WooAccessManager.sol/WooAccessManager.json'

use(solidity)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const BN_TEN = BigNumber.from(10)
const BN_1e18 = BN_TEN.pow(18)
const BN_ZERO = BigNumber.from(0)
const WITHDRAW_FEE = BigNumber.from(500)
const WITHDRAW_FEE_PERIOD = BigNumber.from(86400).mul(7)

describe('WooStakingVault Normal Accuracy', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let treasury: SignerWithAddress

  let wooAccessManager: WooAccessManager
  let wooStakingVault: WooStakingVault
  let wooToken: TestToken

  before(async () => {
    ;[owner, user, treasury] = await ethers.getSigners()
    wooToken = (await deployContract(owner, TestTokenArtifact, [])) as TestToken
    // 1.mint woo token to user
    // 2.make sure user woo balance start with 0
    let mintWooBalance = BN_1e18.mul(1000)
    await wooToken.mint(user.address, mintWooBalance)
    expect(await wooToken.balanceOf(user.address)).to.eq(mintWooBalance)

    wooAccessManager = (await deployContract(owner, WooAccessManagerArtifact, [])) as WooAccessManager
    wooStakingVault = (await deployContract(owner, WooStakingVaultArtifact, [
      wooToken.address,
      treasury.address,
      wooAccessManager.address,
    ])) as WooStakingVault
  })

  it('Check state variables after contract initialized', async () => {
    expect(await wooStakingVault.stakedToken()).to.eq(wooToken.address)
    expect(await wooStakingVault.costSharePrice(user.address)).to.eq(BN_ZERO)
    let [reserveAmount, lastReserveWithdrawTime] = await wooStakingVault.userInfo(user.address)
    expect(reserveAmount).to.eq(BN_ZERO)
    expect(lastReserveWithdrawTime).to.eq(BN_ZERO)

    expect(await wooStakingVault.totalReserveAmount()).to.eq(BN_ZERO)
    expect(await wooStakingVault.withdrawFeePeriod()).to.eq(WITHDRAW_FEE_PERIOD)
    expect(await wooStakingVault.withdrawFee()).to.eq(WITHDRAW_FEE)
    expect(await wooStakingVault.treasury()).to.eq(treasury.address)
  })

  it('Share price should be 1e18 when xWOO non-supply', async () => {
    expect(await wooStakingVault.totalSupply()).to.eq(BN_ZERO)
    expect(await wooStakingVault.getPricePerFullShare()).to.eq(BN_1e18)
  })

  it('deposit', async () => {
    // approve wooStakingVault and deposit by user
    expect(await wooStakingVault.balance()).to.eq(BN_ZERO)
    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)
    await wooStakingVault.connect(user).deposit(wooDeposit)
    // allowance will be 0 after safeTransferFrom(approve 100 and deposit 100 woo token above code)
    expect(await wooToken.allowance(user.address, wooStakingVault.address)).to.eq(BN_ZERO)
    // Check user costSharePrice and xWoo balance after deposit
    expect(await wooStakingVault.costSharePrice(user.address)).to.eq(BN_1e18)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(BN_1e18.mul(100))
  })

  it('Share price should be 2e18 when WOO balance is double xWOO totalSupply', async () => {
    expect(await wooStakingVault.totalSupply()).to.eq(BN_1e18.mul(100))
    // mint 100 WOO to wooStakingVault
    await wooToken.mint(wooStakingVault.address, BN_1e18.mul(100))
    expect(await wooStakingVault.getPricePerFullShare()).to.eq(BN_1e18.mul(2))
  })

  it('reserveWithdraw', async () => {
    // continue by deposit, user woo balance: BN_1e18.mul(900)
    expect(await wooToken.balanceOf(user.address)).to.eq(BN_1e18.mul(900))
    // xWOO(_shares) balance: BN_1e18.mul(100)
    let reserveShares = BN_1e18.mul(100)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(reserveShares)
    // pre check before reserveWithdraw
    let sharePrice = await wooStakingVault.getPricePerFullShare()
    let currentReserveAmount = reserveShares.mul(sharePrice).div(BN_1e18)
    let poolBalance = await wooStakingVault.balance()
    expect(currentReserveAmount).to.eq(poolBalance)
    // make reserve to withdraw woo
    await wooStakingVault.connect(user).reserveWithdraw(reserveShares)
    // xWOO balance should be zero after reserveWithdraw
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(BN_ZERO)
    // totalReserveAmount should add currentReserveAmount
    expect(await wooStakingVault.totalReserveAmount()).to.eq(currentReserveAmount)
    // userInfo update
    let [reserveAmount] = await wooStakingVault.userInfo(user.address)
    expect(reserveAmount).to.eq(currentReserveAmount)
    // can't confirm the block.timestamp, will be confirm on bsc testnet
  })

  it('balance should subtract totalReserveAmount', async () => {
    let totalReserveAmount = await wooStakingVault.totalReserveAmount()
    expect(totalReserveAmount).not.to.eq(BN_ZERO)
    let totalWOOBalance = await wooToken.balanceOf(wooStakingVault.address)
    expect(await wooStakingVault.balance()).to.eq(totalWOOBalance.sub(totalReserveAmount))
  })

  it('withdraw', async () => {
    // user woo balance: BN_1e18.mul(900)
    let userWooBalance = await wooToken.balanceOf(user.address)
    expect(userWooBalance).to.eq(BN_1e18.mul(900))
    // continue by reserveWithdraw, user.reserveAmount: BN_1e18.mul(100)
    let [withdrawAmount] = await wooStakingVault.userInfo(user.address)
    let currentWithdrawFee = withdrawAmount.mul(WITHDRAW_FEE).div(BigNumber.from(10000))
    await wooStakingVault.connect(user).withdraw()
    // treasury will receive fee after withdraw during 3 days
    expect(await wooToken.balanceOf(treasury.address)).to.eq(currentWithdrawFee)
    // withdrawAmount will subtract fee and transfer to user
    expect(await wooToken.balanceOf(user.address)).to.eq(userWooBalance.add(withdrawAmount).sub(currentWithdrawFee))

    expect(await wooStakingVault.totalReserveAmount()).to.eq(BN_ZERO)

    let [reserveAmount] = await wooStakingVault.userInfo(user.address)
    expect(reserveAmount).to.eq(BN_ZERO)
  })

  it('instantWithdraw', async () => {
    // pre check
    expect(await wooToken.balanceOf(wooStakingVault.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.balance()).to.eq(BN_ZERO)
    expect(await wooStakingVault.getPricePerFullShare()).to.eq(BN_1e18)
    expect(await wooStakingVault.totalReserveAmount()).to.eq(BN_ZERO)
    let [reserveAmount] = await wooStakingVault.userInfo(user.address)
    expect(reserveAmount).to.eq(BN_ZERO)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(BN_ZERO)
    // deposit 100 WOO into vault
    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)
    await wooStakingVault.connect(user).deposit(wooDeposit)
    expect(await wooToken.allowance(user.address, wooStakingVault.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(wooDeposit)
    // pretend user as vault, user not in zeroFeeVault, need to be charging fee
    expect(await wooAccessManager.isZeroFeeVault(user.address)).to.eq(false)
    // instantWithdraw by charging fee
    let userWooBalanceBefore = await wooToken.balanceOf(user.address)
    let wooWithdraw = wooDeposit.div(2)
    expect(await wooStakingVault.withdrawFee()).to.eq(WITHDRAW_FEE)
    await wooStakingVault.connect(user).instantWithdraw(wooWithdraw)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(wooWithdraw)
    let currentWithdrawFee = wooWithdraw.mul(WITHDRAW_FEE).div(BigNumber.from(10000))
    let userWooBalanceAfter = await wooToken.balanceOf(user.address)
    expect(userWooBalanceAfter).to.eq(userWooBalanceBefore.add(wooWithdraw).sub(currentWithdrawFee))
    // instantWithdraw no charging fee
    userWooBalanceBefore = await wooToken.balanceOf(user.address)
    await wooStakingVault.setWithdrawFee(BN_ZERO)
    expect(await wooStakingVault.withdrawFee()).to.eq(BN_ZERO)
    await wooStakingVault.connect(user).instantWithdraw(wooWithdraw)
    userWooBalanceAfter = await wooToken.balanceOf(user.address)
    expect(userWooBalanceAfter).to.eq(userWooBalanceBefore.add(wooWithdraw))
  })

  it('instantWithdraw by zeroFeeVault from WooAccessManager without charging fee', async () => {
    // pre check
    expect(await wooToken.balanceOf(wooStakingVault.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.balance()).to.eq(BN_ZERO)
    expect(await wooStakingVault.getPricePerFullShare()).to.eq(BN_1e18)
    expect(await wooStakingVault.totalReserveAmount()).to.eq(BN_ZERO)
    let [reserveAmount] = await wooStakingVault.userInfo(user.address)
    expect(reserveAmount).to.eq(BN_ZERO)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(BN_ZERO)
    // deposit 100 WOO into vault
    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)
    await wooStakingVault.connect(user).deposit(wooDeposit)
    expect(await wooToken.allowance(user.address, wooStakingVault.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(wooDeposit)
    // pretend user as vault, set user to zeroFeeVault, remove it at the last of this test case
    expect(await wooAccessManager.isZeroFeeVault(user.address)).to.eq(false)
    await wooAccessManager.connect(owner).setZeroFeeVault(user.address, true)
    expect(await wooAccessManager.isZeroFeeVault(user.address)).to.eq(true)
    // withdrawFee exist, but instantWithdraw without charging fee by zeroFeeVault
    let userWooBalanceBefore = await wooToken.balanceOf(user.address)
    await wooStakingVault.setWithdrawFee(WITHDRAW_FEE)
    expect(await wooStakingVault.withdrawFee()).to.eq(WITHDRAW_FEE)
    await wooStakingVault.connect(user).instantWithdraw(wooDeposit)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(BN_ZERO)
    let zeroFeeVaultWithdrawFee = BN_ZERO
    let userWooBalanceAfter = await wooToken.balanceOf(user.address)
    expect(userWooBalanceAfter).to.eq(userWooBalanceBefore.add(wooDeposit).sub(zeroFeeVaultWithdrawFee))
    // cancel user from zeroFeeVault
    await wooAccessManager.connect(owner).setZeroFeeVault(user.address, false)
    expect(await wooAccessManager.isZeroFeeVault(user.address)).to.eq(false)
  })

  it('addReward', async () => {
    // pre check
    expect(await wooToken.balanceOf(wooStakingVault.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.balance()).to.eq(BN_ZERO)
    expect(await wooStakingVault.getPricePerFullShare()).to.eq(BN_1e18)
    expect(await wooStakingVault.totalReserveAmount()).to.eq(BN_ZERO)
    let [reserveAmount] = await wooStakingVault.userInfo(user.address)
    expect(reserveAmount).to.eq(BN_ZERO)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(BN_ZERO)
    expect(await wooToken.balanceOf(owner.address)).to.eq(BN_ZERO)
    // deposit 100 WOO into vault
    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)
    await wooStakingVault.connect(user).deposit(wooDeposit)
    expect(await wooToken.allowance(user.address, wooStakingVault.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(wooDeposit)
    // mint WOO to owner
    await wooToken.mint(owner.address, wooDeposit)
    expect(await wooToken.balanceOf(owner.address)).to.eq(wooDeposit)
    // owner send reward and share price should increase
    let balanceBefore = await wooStakingVault.balance()
    let sharePriceBefore = await wooStakingVault.getPricePerFullShare()
    let xTotalSupplyBefore = await wooStakingVault.totalSupply()
    await wooToken.connect(owner).approve(wooStakingVault.address, wooDeposit)
    await wooStakingVault.connect(owner).addReward(wooDeposit)
    expect(await wooToken.balanceOf(owner.address)).to.eq(BN_ZERO)
    let balanceAfter = await wooStakingVault.balance()
    let sharePriceAfter = await wooStakingVault.getPricePerFullShare()
    let xTotalSupplyAfter = await wooStakingVault.totalSupply()
    expect(balanceAfter).to.eq(balanceBefore.add(wooDeposit))
    expect(sharePriceAfter).to.gt(sharePriceBefore)
    expect(xTotalSupplyAfter).to.eq(xTotalSupplyBefore)
    expect(sharePriceAfter).to.eq(balanceAfter.mul(BN_1e18).div(xTotalSupplyBefore))
  })
})

describe('WooStakingVault Complex Accuracy', () => {
  let owner: SignerWithAddress
  let smallHolder: SignerWithAddress
  let middleHolder: SignerWithAddress
  let bigHolder: SignerWithAddress
  let treasury: SignerWithAddress
  let newTreasury: SignerWithAddress

  let holders: Array<SignerWithAddress>

  let wooAccessManager: WooAccessManager
  let wooStakingVault: WooStakingVault
  let wooToken: TestToken

  let baseMint = BN_1e18.mul(1000)
  let baseDeposit = BN_1e18.mul(100)

  before(async () => {
    ;[owner, smallHolder, middleHolder, bigHolder, treasury, newTreasury] = await ethers.getSigners()
    holders = [smallHolder, middleHolder, bigHolder]
    wooToken = (await deployContract(owner, TestTokenArtifact, [])) as TestToken

    wooAccessManager = (await deployContract(owner, WooAccessManagerArtifact, [])) as WooAccessManager
    wooStakingVault = (await deployContract(owner, WooStakingVaultArtifact, [
      wooToken.address,
      treasury.address,
      wooAccessManager.address,
    ])) as WooStakingVault

    // mint 10000000 to owner as interest preparation
    await wooToken.mint(owner.address, baseMint.mul(BN_TEN.pow(BigNumber.from('4'))))
    // 1.mint woo token to holder with different amount
    // 2.make sure each holder woo balance start with 0
    for (let i in holders) {
      // small: 1000 / middle: 10000 / big: 100000
      let holder = holders[i]
      let mintWooBalance = baseMint.mul(BN_TEN.pow(BigNumber.from(i)))
      await wooToken.mint(holder.address, mintWooBalance)
      expect(await wooToken.balanceOf(holder.address)).to.eq(mintWooBalance)
      await wooToken.connect(holder).approve(wooStakingVault.address, mintWooBalance)
    }
  })

  it('Deposit by multiple holders', async () => {
    // make sure vault start with 0 balance
    expect(await wooStakingVault.balance()).to.eq(BN_ZERO)
    // holder approved in before(), therefore here can be deposited directly
    for (let i in holders) {
      let holder = holders[i]
      // different holder mapping to different amount for deposit
      let wooDeposit = baseDeposit.mul(BN_TEN.pow(BigNumber.from(i)))
      await wooStakingVault.connect(holder).deposit(wooDeposit)
    }
    // check everything after three holders deposited
    for (let i in holders) {
      let holder = holders[i]
      expect(await wooToken.allowance(holder.address, wooStakingVault.address)).to.eq(
        baseMint.sub(baseDeposit).mul(BN_TEN.pow(BigNumber.from(i)))
      )
      expect(await wooStakingVault.costSharePrice(holder.address)).to.eq(BN_1e18)
      // WOO and xWOO ratio should be 1:1 when cost share price equal to BN_1e18
      let wooDeposit = baseDeposit.mul(BN_TEN.pow(BigNumber.from(i)))
      expect(await wooStakingVault.balanceOf(holder.address)).to.eq(wooDeposit)
    }
  })

  it('Share price should change when owner transfer WOO as interest to vault', async () => {
    let wooBalanceBefore = await wooStakingVault.balance() // balance of WOO before transfer
    let xTotalSupplyBefore = await wooStakingVault.totalSupply() // balance of xWOO before transfer
    expect(wooBalanceBefore).to.eq(xTotalSupplyBefore)
    expect(await wooStakingVault.getPricePerFullShare()).to.eq(wooBalanceBefore.mul(BN_1e18).div(xTotalSupplyBefore))

    // transfer 100000 WOO to vault
    await wooToken.connect(owner).transfer(wooStakingVault.address, BN_1e18.mul(BN_TEN.pow(BigNumber.from(5))))

    let wooBalanceAfter = await wooStakingVault.balance() // balance of WOO after transfer
    let xTotalSupplyAfter = await wooStakingVault.totalSupply() // balance of xWOO after transfer
    // xTotalSupply should not be changed after transfer
    expect(xTotalSupplyAfter).to.eq(xTotalSupplyBefore)
    // wooBalanceAfter should greater to xTotalSupplyAfter
    expect(wooBalanceAfter).to.gt(xTotalSupplyAfter)
    // share price should greater than 1e18 after transfer
    let sharePriceAfter = await wooStakingVault.getPricePerFullShare()
    expect(sharePriceAfter).to.gt(BN_1e18)
    expect(sharePriceAfter).to.eq(wooBalanceAfter.mul(BN_1e18).div(xTotalSupplyAfter))
  })

  it('ReserveWithdraw by multiple holders', async () => {
    expect(await wooStakingVault.totalReserveAmount()).to.eq(BN_ZERO)
    // 1.reserveWithdraw start with bigHolder
    let bigHolderReserveShares = await wooStakingVault.balanceOf(bigHolder.address)
    let sharePriceBeforeBigReserve = await wooStakingVault.getPricePerFullShare()
    let bigCalReserveAmount = bigHolderReserveShares.mul(sharePriceBeforeBigReserve).div(BN_1e18)
    // make reserve to withdraw woo
    await wooStakingVault.connect(bigHolder).reserveWithdraw(bigHolderReserveShares)
    // xWOO balance should be zero after reserveWithdraw
    expect(await wooStakingVault.balanceOf(bigHolder.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.totalReserveAmount()).to.eq(bigCalReserveAmount)
    let [bigReserveAmount] = await wooStakingVault.userInfo(bigHolder.address)
    expect(bigReserveAmount).to.eq(bigCalReserveAmount)
    // share price should not be changed even big holder xWOO has been burned
    let sharePriceAfterBigReserve = await wooStakingVault.getPricePerFullShare()
    expect(sharePriceAfterBigReserve).to.eq(sharePriceBeforeBigReserve)

    // 2.reserveWithdraw continue with smallHolder after owner transfer WOO as interest
    // transfer 10000 WOO to vault
    await wooToken.connect(owner).transfer(wooStakingVault.address, BN_1e18.mul(BN_TEN.pow(BigNumber.from(4))))

    let smallHolderReserveShares = await wooStakingVault.balanceOf(smallHolder.address)
    let sharePriceBeforeSmallReserve = await wooStakingVault.getPricePerFullShare()
    let smallCalReserveAmount = smallHolderReserveShares.mul(sharePriceBeforeSmallReserve).div(BN_1e18)
    // make reserve to withdraw woo
    await wooStakingVault.connect(smallHolder).reserveWithdraw(smallHolderReserveShares)
    // xWOO balance should be zero after reserveWithdraw
    expect(await wooStakingVault.balanceOf(smallHolder.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.totalReserveAmount()).to.eq(bigCalReserveAmount.add(smallCalReserveAmount))
    let [smallReserveAmount] = await wooStakingVault.userInfo(smallHolder.address)
    expect(smallReserveAmount).to.eq(smallCalReserveAmount)
    // share price should not be changed even small holder xWOO has been burned
    let sharePriceAfterSmallReserve = await wooStakingVault.getPricePerFullShare()
    expect(sharePriceAfterSmallReserve).to.eq(sharePriceBeforeSmallReserve)

    // 3.reserveWithdraw end with middleHolder
    let middleHolderReserveShares = await wooStakingVault.balanceOf(middleHolder.address)
    let sharePriceBeforeMiddleReserve = await wooStakingVault.getPricePerFullShare()
    let middleCalReserveAmount = middleHolderReserveShares.mul(sharePriceBeforeMiddleReserve).div(BN_1e18)
    // make reserve to withdraw woo
    await wooStakingVault.connect(middleHolder).reserveWithdraw(middleHolderReserveShares)
    // xWOO balance should be zero after reserveWithdraw
    expect(await wooStakingVault.balanceOf(middleHolder.address)).to.eq(BN_ZERO)
    let totalReserveAmount = await wooStakingVault.totalReserveAmount()
    expect(totalReserveAmount).to.eq(bigCalReserveAmount.add(smallCalReserveAmount).add(middleCalReserveAmount))
    // totalSupply() should be zero right now
    expect(await wooStakingVault.totalSupply()).to.eq(BN_ZERO)
    let [middleReserveAmount] = await wooStakingVault.userInfo(middleHolder.address)
    expect(middleReserveAmount).to.eq(middleCalReserveAmount)
    // cause balance and totalSupply() be zero, share price should be 1e18
    let sharePriceAfterMiddleReserve = await wooStakingVault.getPricePerFullShare()
    expect(sharePriceAfterMiddleReserve).to.eq(BN_1e18)
  })

  it('withdraw by multiple holders', async () => {
    // 1.withdraw start with big holder and subtract withdraw fee cause withdrawFeePeriod is 3 days
    let bigHolderBalance = await wooToken.balanceOf(bigHolder.address)
    let totalRABeforeBigWithdraw = await wooStakingVault.totalReserveAmount()

    let [bigWithdrawAmount] = await wooStakingVault.userInfo(bigHolder.address)
    let bigWithdrawFee = bigWithdrawAmount.mul(WITHDRAW_FEE).div(BigNumber.from(10000))
    await wooStakingVault.connect(bigHolder).withdraw()
    expect(await wooToken.balanceOf(treasury.address)).to.eq(bigWithdrawFee)
    expect(await wooToken.balanceOf(bigHolder.address)).to.eq(
      bigHolderBalance.add(bigWithdrawAmount).sub(bigWithdrawFee)
    )

    expect(await wooStakingVault.totalReserveAmount()).to.eq(totalRABeforeBigWithdraw.sub(bigWithdrawAmount))
    let [reserveAmountAfterBigWithdraw] = await wooStakingVault.userInfo(bigHolder.address)
    expect(reserveAmountAfterBigWithdraw).to.eq(BN_ZERO)

    // 2.withdraw continue with small holder and set withdraw fee to zero
    await wooStakingVault.setWithdrawFee(BN_ZERO)
    let withdrawFee = await wooStakingVault.withdrawFee()

    let smallHolderBalance = await wooToken.balanceOf(smallHolder.address)
    let [smallWithdrawAmount] = await wooStakingVault.userInfo(smallHolder.address)
    let smallWithdrawFee = smallWithdrawAmount.mul(withdrawFee).div(BigNumber.from(10000))
    expect(smallWithdrawFee).to.eq(BN_ZERO)

    await wooStakingVault.connect(smallHolder).withdraw()
    // there is no fee transfer into treasury, therefore the balanceOf should equal to bigWithdrawFee(only charging fee one time above)
    expect(await wooToken.balanceOf(treasury.address)).to.eq(bigWithdrawFee)
    // no charging fee, therefore small holder balance should add smallWithdrawAmount directly
    expect(await wooToken.balanceOf(smallHolder.address)).to.eq(smallHolderBalance.add(smallWithdrawAmount))

    // 3.withdraw end with middle holder and set withdraw fee to origin, set withdrawFeePeriod to zero
    let originWithdrawFee = WITHDRAW_FEE
    await wooStakingVault.setWithdrawFee(originWithdrawFee)
    expect(await wooStakingVault.withdrawFee()).to.eq(originWithdrawFee)
    await wooStakingVault.setWithdrawFeePeriod(BN_ZERO)

    let middleHolderBalance = await wooToken.balanceOf(middleHolder.address)
    let [middleWithdrawAmount] = await wooStakingVault.userInfo(middleHolder.address)

    await wooStakingVault.connect(middleHolder).withdraw()
    // withdrawFeePeriod set to zero now, it mean once user deposit, can be withdraw immediately without charging fee
    // even withdrawFee is set to origin(0.1%)
    // therefore the balanceOf should equal to bigWithdrawFee(only charging fee one time above)
    expect(await wooToken.balanceOf(treasury.address)).to.eq(bigWithdrawFee)
    // no charging fee, therefore middle holder balance should add middleWithdrawAmount directly
    expect(await wooToken.balanceOf(middleHolder.address)).to.eq(middleHolderBalance.add(middleWithdrawAmount))
  })
})

describe('WooStakingVault Access Control & Require Check', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let treasury: SignerWithAddress
  let newTreasury: SignerWithAddress

  let wooAccessManager: WooAccessManager
  let newWooAccessManager: WooAccessManager
  let wooStakingVault: WooStakingVault
  let wooToken: TestToken
  let btcToken: TestToken

  let initialTreasuryZeroAddressMessage: string
  let newTreasuryZeroAddressMessage: string
  let initialWooAccessManagerZeroAddressMessage: string
  let newWooAccessManagerZeroAddressMessage: string
  let depositAmountEqualToZeroMessage: string
  let reserveWithdrawSharesEqualToZeroMessage: string
  let withdrawWithdrawAmountEqualToZeroMessage: string
  let instantWithdrawSharesEqualToZeroMessage: string
  let addRewardAmountEqualToZeroMessage: string
  let sharesExceedBalanceMessage: string
  let nonContractAccountMessage: string
  let onlyOwnerRevertedMessage: string
  let setWithdrawFeePeriodExceedMessage: string
  let setWithdrawFeeExceedMessage: string
  let stuckTokenZeroAddressMessage: string
  let stuckTokenCanNotBeStakedTokenMessage: string
  let whenNotPausedRevertedMessage: string
  let whenPausedRevertedMessage: string

  before(async () => {
    ;[owner, user, treasury, newTreasury] = await ethers.getSigners()
    wooToken = (await deployContract(owner, TestTokenArtifact, [])) as TestToken
    btcToken = (await deployContract(owner, TestTokenArtifact, [])) as TestToken
    // 1.mint woo token to user
    // 2.make sure user woo balance start with 0
    let mintWooBalance = BN_1e18.mul(1000)
    await wooToken.mint(user.address, mintWooBalance)
    expect(await wooToken.balanceOf(user.address)).to.eq(mintWooBalance)

    wooAccessManager = (await deployContract(owner, WooAccessManagerArtifact, [])) as WooAccessManager
    newWooAccessManager = (await deployContract(owner, WooAccessManagerArtifact, [])) as WooAccessManager
    wooStakingVault = (await deployContract(owner, WooStakingVaultArtifact, [
      wooToken.address,
      treasury.address,
      wooAccessManager.address,
    ])) as WooStakingVault

    initialTreasuryZeroAddressMessage = 'WooStakingVault: initialTreasury_ZERO_ADDR'
    newTreasuryZeroAddressMessage = 'WooStakingVault: newTreasury_ZERO_ADDR'
    initialWooAccessManagerZeroAddressMessage = 'WooStakingVault: initialWooAccessManager_ZERO_ADDR'
    newWooAccessManagerZeroAddressMessage = 'WooStakingVault: newWooAccessManager_ZERO_ADDR'
    depositAmountEqualToZeroMessage = 'WooStakingVault: amount_CAN_NOT_BE_ZERO'
    reserveWithdrawSharesEqualToZeroMessage = 'WooStakingVault: shares_CAN_NOT_BE_ZERO'
    withdrawWithdrawAmountEqualToZeroMessage = 'WooStakingVault: withdrawAmount_CAN_NOT_BE_ZERO'
    instantWithdrawSharesEqualToZeroMessage = 'WooStakingVault: shares_CAN_NOT_BE_ZERO'
    addRewardAmountEqualToZeroMessage = 'WooStakingVault: amount_CAN_NOT_BE_ZERO'
    sharesExceedBalanceMessage = 'WooStakingVault: shares exceed balance'
    nonContractAccountMessage = 'function call to a non-contract account'
    onlyOwnerRevertedMessage = 'Ownable: caller is not the owner'
    setWithdrawFeePeriodExceedMessage = 'WooStakingVault: newWithdrawFeePeriod>MAX_WITHDRAW_FEE_PERIOD'
    setWithdrawFeeExceedMessage = 'WooStakingVault: newWithdrawFee>MAX_WITHDRAW_FEE'
    stuckTokenZeroAddressMessage = 'WooStakingVault: stuckToken_ZERO_ADDR'
    stuckTokenCanNotBeStakedTokenMessage = 'WooStakingVault: stuckToken_CAN_NOT_BE_stakedToken'
    whenNotPausedRevertedMessage = 'Pausable: paused'
    whenPausedRevertedMessage = 'Pausable: not paused'
  })

  it('Initial staked token can not be zero address', async () => {
    await expect(
      deployContract(owner, WooStakingVaultArtifact, [ZERO_ADDRESS, treasury.address, wooAccessManager.address])
    ).to.be.revertedWith(nonContractAccountMessage)
  })

  it('Initial treasury can not be zero address', async () => {
    await expect(
      deployContract(owner, WooStakingVaultArtifact, [wooToken.address, ZERO_ADDRESS, wooAccessManager.address])
    ).to.be.revertedWith(initialTreasuryZeroAddressMessage)
  })

  it('Initial wooAccessManager can not be zero address', async () => {
    await expect(
      deployContract(owner, WooStakingVaultArtifact, [wooToken.address, treasury.address, ZERO_ADDRESS])
    ).to.be.revertedWith(initialWooAccessManagerZeroAddressMessage)
  })

  it('deposit will be okay when amount equal to zero', async () => {
    await wooStakingVault.connect(user).deposit(BN_ZERO)
  })

  it('reserveWithdraw will be reverted when shares equal to zero', async () => {
    await expect(wooStakingVault.connect(user).reserveWithdraw(BN_ZERO)).to.be.revertedWith(
      reserveWithdrawSharesEqualToZeroMessage
    )
  })

  it('withdraw will be reverted when withdrawAmount equal to zero', async () => {
    let [withdrawAmount] = await wooStakingVault.userInfo(user.address)
    expect(withdrawAmount).to.eq(BN_ZERO)
    await expect(wooStakingVault.connect(user).withdraw()).to.be.revertedWith(withdrawWithdrawAmountEqualToZeroMessage)
  })

  it('instantWithdraw will be reverted when shares equal to zero', async () => {
    await expect(wooStakingVault.connect(user).instantWithdraw(BN_ZERO)).to.be.revertedWith(
      instantWithdrawSharesEqualToZeroMessage
    )
  })

  it('addReward will be reverted when amount equal to zero', async () => {
    await expect(wooStakingVault.connect(user).addReward(BN_ZERO)).to.be.revertedWith(addRewardAmountEqualToZeroMessage)
  })

  it('reserveWithdraw shares exceed balance will be reverted', async () => {
    let exceedShares = BN_1e18.mul(200)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.balanceOf(user.address)).to.lt(exceedShares)
    await expect(wooStakingVault.connect(user).reserveWithdraw(exceedShares)).to.be.revertedWith(
      sharesExceedBalanceMessage
    )
  })

  it('instantWithdraw shares exceed balance will be reverted', async () => {
    let exceedShares = BN_1e18.mul(200)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(BN_ZERO)
    expect(await wooStakingVault.balanceOf(user.address)).to.lt(exceedShares)
    await expect(wooStakingVault.connect(user).instantWithdraw(exceedShares)).to.be.revertedWith(
      sharesExceedBalanceMessage
    )
  })

  it('Only owner able to setWithdrawFeePeriod', async () => {
    let withdrawFeePeriod = BigNumber.from(86400) // 1 days
    await expect(wooStakingVault.connect(user).setWithdrawFeePeriod(withdrawFeePeriod)).to.be.revertedWith(
      onlyOwnerRevertedMessage
    )
    await wooStakingVault.connect(owner).setWithdrawFeePeriod(withdrawFeePeriod)
    expect(await wooStakingVault.withdrawFeePeriod()).to.eq(withdrawFeePeriod)
  })

  it('New withdrawFeePeriod can not exceed MAX_WITHDRAW_FEE_PERIOD when setWithdrawFeePeriod', async () => {
    let maxWithdrawFeePeriod = await wooStakingVault.MAX_WITHDRAW_FEE_PERIOD()
    let newWithdrawFeePeriod = maxWithdrawFeePeriod.add(BigNumber.from(86400)) // add 1 days
    await expect(wooStakingVault.connect(owner).setWithdrawFeePeriod(newWithdrawFeePeriod)).to.be.revertedWith(
      setWithdrawFeePeriodExceedMessage
    )
  })

  it('Only owner able to setWithdrawFee', async () => {
    let withdrawFee = BigNumber.from(20) // 0.2%
    await expect(wooStakingVault.connect(user).setWithdrawFee(withdrawFee)).to.be.revertedWith(onlyOwnerRevertedMessage)
    await wooStakingVault.connect(owner).setWithdrawFee(withdrawFee)
    expect(await wooStakingVault.withdrawFee()).to.eq(withdrawFee)
  })

  it('New withdrawFee can not exceed MAX_WITHDRAW_FEE when setWithdrawFee', async () => {
    let maxWithdrawFee = await wooStakingVault.MAX_WITHDRAW_FEE()
    let newWithdrawFee = maxWithdrawFee.add(BN_TEN) // add 0.1%
    await expect(wooStakingVault.connect(owner).setWithdrawFee(newWithdrawFee)).to.be.revertedWith(
      setWithdrawFeeExceedMessage
    )
  })

  it('Only owner able to setTreasury', async () => {
    await expect(wooStakingVault.connect(user).setTreasury(newTreasury.address)).to.be.revertedWith(
      onlyOwnerRevertedMessage
    )
    await wooStakingVault.connect(owner).setTreasury(newTreasury.address)
    expect(await wooStakingVault.treasury()).to.eq(newTreasury.address)
  })

  it('New treasury can not be zero address', async () => {
    await expect(wooStakingVault.connect(owner).setTreasury(ZERO_ADDRESS)).to.be.revertedWith(
      newTreasuryZeroAddressMessage
    )
  })

  it('Only owner able to setWooAccessManager', async () => {
    await expect(wooStakingVault.connect(user).setWooAccessManager(newWooAccessManager.address)).to.be.revertedWith(
      onlyOwnerRevertedMessage
    )
    await wooStakingVault.connect(owner).setWooAccessManager(newWooAccessManager.address)
    expect(await wooStakingVault.wooAccessManager()).to.eq(newWooAccessManager.address)
  })

  it('New wooAccessManager can not be zero address', async () => {
    await expect(wooStakingVault.connect(owner).setWooAccessManager(ZERO_ADDRESS)).to.be.revertedWith(
      newWooAccessManagerZeroAddressMessage
    )
  })

  it('Only owner able to inCaseTokensGetStuck', async () => {
    let mintBtcBalance = BN_1e18.mul(10)
    await btcToken.mint(wooStakingVault.address, mintBtcBalance)
    expect(await btcToken.balanceOf(wooStakingVault.address)).to.eq(mintBtcBalance)

    expect(await btcToken.balanceOf(user.address)).to.eq(BN_ZERO)
    await expect(wooStakingVault.connect(user).inCaseTokensGetStuck(btcToken.address)).to.be.revertedWith(
      onlyOwnerRevertedMessage
    )
    expect(await btcToken.balanceOf(user.address)).to.eq(BN_ZERO)

    expect(await btcToken.balanceOf(owner.address)).to.eq(BN_ZERO)
    await wooStakingVault.connect(owner).inCaseTokensGetStuck(btcToken.address)
    expect(await btcToken.balanceOf(owner.address)).to.eq(mintBtcBalance)
    expect(await btcToken.balanceOf(wooStakingVault.address)).to.eq(BN_ZERO)
  })

  it('StuckToken can not be zero address', async () => {
    await expect(wooStakingVault.connect(owner).inCaseTokensGetStuck(ZERO_ADDRESS)).to.be.revertedWith(
      stuckTokenZeroAddressMessage
    )
  })

  it('StuckToken can not be stakedToken', async () => {
    let stakedToken = await wooStakingVault.stakedToken()
    await expect(wooStakingVault.connect(owner).inCaseTokensGetStuck(stakedToken)).to.be.revertedWith(
      stuckTokenCanNotBeStakedTokenMessage
    )
  })

  it('Only owner able to pause', async () => {
    await expect(wooStakingVault.connect(user).pause()).to.be.revertedWith(onlyOwnerRevertedMessage)
    await wooStakingVault.connect(owner).pause()

    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)
    // deposit will be reverted when contract is paused
    await expect(wooStakingVault.connect(user).deposit(wooDeposit)).to.be.revertedWith(whenNotPausedRevertedMessage)
  })

  it('Only owner able to unpause', async () => {
    // make sure contract is paused now
    expect(await wooStakingVault.paused()).to.eq(true)
    // start to unpause
    await expect(wooStakingVault.connect(user).unpause()).to.be.revertedWith(onlyOwnerRevertedMessage)
    await wooStakingVault.connect(owner).unpause()
    expect(await wooStakingVault.paused()).to.eq(false)
    // unpause will be reverted when contract is working
    await expect(wooStakingVault.unpause()).to.be.revertedWith(whenPausedRevertedMessage)
  })
})

describe('WooStakingVault Event', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let treasury: SignerWithAddress

  let wooAccessManager: WooAccessManager
  let wooStakingVault: WooStakingVault
  let wooToken: TestToken

  before(async () => {
    ;[owner, user, treasury] = await ethers.getSigners()
    wooToken = (await deployContract(owner, TestTokenArtifact, [])) as TestToken
    // 1.mint woo token to user
    // 2.make sure user woo balance start with 0
    let mintWooBalance = BN_1e18.mul(1000)
    await wooToken.mint(user.address, mintWooBalance)
    expect(await wooToken.balanceOf(user.address)).to.eq(mintWooBalance)

    wooAccessManager = (await deployContract(owner, WooAccessManagerArtifact, [])) as WooAccessManager
    wooStakingVault = (await deployContract(owner, WooStakingVaultArtifact, [
      wooToken.address,
      treasury.address,
      wooAccessManager.address,
    ])) as WooStakingVault
  })

  it('Deposit', async () => {
    // approve wooStakingVault and deposit by user
    expect(await wooStakingVault.balance()).to.eq(BN_ZERO)
    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)

    await expect(wooStakingVault.connect(user).deposit(wooDeposit)).to.emit(wooStakingVault, 'Deposit').withArgs(
      user.address,
      wooDeposit,
      BN_1e18.mul(100) // mintShares equal to wooDeposit when share price is 1e18
    )
  })

  it('ReserveWithdraw', async () => {
    // continue by deposit, user woo balance: BN_1e18.mul(900)
    expect(await wooToken.balanceOf(user.address)).to.eq(BN_1e18.mul(900))
    // xWOO(_shares) balance: BN_1e18.mul(100)
    let reserveShares = BN_1e18.mul(100)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(reserveShares)
    // pre check before reserveWithdraw
    let sharePrice = await wooStakingVault.getPricePerFullShare()
    let currentReserveAmount = reserveShares.mul(sharePrice).div(BN_1e18)
    let poolBalance = await wooStakingVault.balance()
    expect(currentReserveAmount).to.eq(poolBalance)
    // make reserve to withdraw woo
    await expect(wooStakingVault.connect(user).reserveWithdraw(reserveShares))
      .to.emit(wooStakingVault, 'ReserveWithdraw')
      .withArgs(user.address, currentReserveAmount, reserveShares)
  })

  it('Withdraw', async () => {
    // user woo balance: BN_1e18.mul(900)
    let userWooBalance = await wooToken.balanceOf(user.address)
    expect(userWooBalance).to.eq(BN_1e18.mul(900))
    // continue by reserveWithdraw, user.reserveAmount: BN_1e18.mul(100)
    let [withdrawAmount] = await wooStakingVault.userInfo(user.address)
    let currentWithdrawFee = withdrawAmount.mul(WITHDRAW_FEE).div(BigNumber.from(10000))

    await expect(wooStakingVault.connect(user).withdraw())
      .to.emit(wooStakingVault, 'Withdraw')
      .withArgs(user.address, withdrawAmount, currentWithdrawFee)
  })

  it('InstantWithdraw with zero fee', async () => {
    expect(await wooToken.balanceOf(wooStakingVault.address)).to.eq(BN_ZERO)
    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)
    await wooStakingVault.connect(user).deposit(wooDeposit)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(wooDeposit)

    await wooStakingVault.connect(owner).setWithdrawFee(BN_ZERO)
    await expect(wooStakingVault.connect(user).instantWithdraw(wooDeposit))
      .to.emit(wooStakingVault, 'InstantWithdraw')
      .withArgs(user.address, wooDeposit, BN_ZERO)
  })

  it('InstantWithdraw with 1% fee', async () => {
    expect(await wooToken.balanceOf(wooStakingVault.address)).to.eq(BN_ZERO)
    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)
    await wooStakingVault.connect(user).deposit(wooDeposit)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(wooDeposit)

    let feeRate = BigNumber.from(100)
    await wooStakingVault.connect(owner).setWithdrawFee(feeRate)
    await expect(wooStakingVault.connect(user).instantWithdraw(wooDeposit))
      .to.emit(wooStakingVault, 'InstantWithdraw')
      .withArgs(user.address, wooDeposit, wooDeposit.mul(feeRate).div(10000))
  })

  it('RewardAdded', async () => {
    expect(await wooToken.balanceOf(wooStakingVault.address)).to.eq(BN_ZERO)
    let wooDeposit = BN_1e18.mul(100)
    await wooToken.connect(user).approve(wooStakingVault.address, wooDeposit)
    await wooStakingVault.connect(user).deposit(wooDeposit)
    expect(await wooStakingVault.balanceOf(user.address)).to.eq(wooDeposit)
    expect(await wooToken.balanceOf(owner.address)).to.eq(BN_ZERO)
    // mint WOO to owner
    await wooToken.mint(owner.address, wooDeposit)
    expect(await wooToken.balanceOf(owner.address)).to.eq(wooDeposit)
    // owner send reward and share price should increase
    let balanceBefore = await wooStakingVault.balance()
    let sharePriceBefore = await wooStakingVault.getPricePerFullShare()
    let xTotalSupply = await wooStakingVault.totalSupply()
    let calBalanceAfter = balanceBefore.add(wooDeposit)
    let calSharePriceAfter = calBalanceAfter.mul(BN_1e18).div(xTotalSupply)
    await wooToken.connect(owner).approve(wooStakingVault.address, wooDeposit)

    await expect(wooStakingVault.connect(owner).addReward(wooDeposit))
      .to.emit(wooStakingVault, 'RewardAdded')
      .withArgs(owner.address, balanceBefore, sharePriceBefore, calBalanceAfter, calSharePriceAfter)
    expect(await wooStakingVault.balance()).to.eq(calBalanceAfter)
    expect(await wooStakingVault.getPricePerFullShare()).to.eq(calSharePriceAfter)
  })
})
