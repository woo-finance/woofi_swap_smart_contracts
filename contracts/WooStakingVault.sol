// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

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

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/utils/Address.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Pausable.sol';
import '@uniswap/lib/contracts/libraries/TransferHelper.sol';

import './libraries/DecimalMath.sol';

contract WooStakingVault is ERC20, Ownable, Pausable {
    using SafeERC20 for IERC20;
    using Address for address;
    using SafeMath for uint256;
    using DecimalMath for uint256;

    struct UserInfo {
        uint256 reserveAmount; // amount of stakedToken user reverseWithdraw
        uint256 lastReserveWithdrawTime; // keeps track of reverseWithdraw time for potential penalty
    }

    /* ----- Events ----- */

    event Deposit(address indexed user, uint256 depositAmount, uint256 mintShares);
    event ReserveWithdraw(address indexed user, uint256 reserveAmount, uint256 burnShares);
    event Withdraw(address indexed user, uint256 withdrawAmount, uint256 withdrawFee);
    event InstantWithdraw(address indexed user, uint256 withdrawAmount, uint256 withdrawFee);

    /* ----- State variables ----- */

    IERC20 public stakedToken;
    mapping(address => uint256) public costSharePrice;
    mapping(address => UserInfo) public userInfo;

    uint256 public totalReserveAmount = 0; // affected by reserveWithdraw and withdraw
    uint256 public withdrawFeePeriod = 72 hours; // 3 days
    uint256 public withdrawFee = 10; // 0.1% (10000 as denominator)

    address public treasury;

    /* ----- Constant variables ----- */

    uint256 public constant MAX_WITHDRAW_FEE_PERIOD = 72 hours; // 3 days
    uint256 public constant MAX_WITHDRAW_FEE = 100; // 1% (10000 as denominator)

    constructor(address initialStakedToken, address initialTreasury)
        public
        ERC20(
            string(abi.encodePacked('Interest bearing ', ERC20(initialStakedToken).name())),
            string(abi.encodePacked('x', ERC20(initialStakedToken).symbol()))
        )
    {
        require(initialStakedToken != address(0), 'WooStakingVault: initialStakedToken_ZERO_ADDR');
        require(initialTreasury != address(0), 'WooStakingVault: initialTreasury_ZERO_ADDR');

        stakedToken = IERC20(initialStakedToken);
        treasury = initialTreasury;
    }

    /* ----- External Functions ----- */

    function deposit(uint256 amount) external whenNotPaused {
        uint256 balanceBefore = balance();
        TransferHelper.safeTransferFrom(address(stakedToken), msg.sender, address(this), amount);
        uint256 balanceAfter = balance();
        amount = balanceAfter.sub(balanceBefore);

        uint256 xTotalSupply = totalSupply();
        uint256 shares = xTotalSupply == 0 ? amount : amount.mul(xTotalSupply).div(balanceBefore);

        // must be execute before _mint
        _updateCostSharePrice(amount, shares);

        _mint(msg.sender, shares);

        emit Deposit(msg.sender, amount, shares);
    }

    function reserveWithdraw(uint256 shares) external whenNotPaused {
        require(shares <= balanceOf(msg.sender), 'WooStakingVault: shares exceed balance');

        uint256 currentReserveAmount = shares.mul(getPricePerFullShare()).div(1e18); // calculate reserveAmount before _burn
        uint256 poolBalance = balance();
        if (poolBalance < currentReserveAmount) {
            // incase reserve amount exceeds pool balance
            currentReserveAmount = poolBalance;
        }
        _burn(msg.sender, shares); // _burn will check the balance of user's shares enough or not

        totalReserveAmount = totalReserveAmount.add(currentReserveAmount);

        UserInfo storage user = userInfo[msg.sender];
        user.reserveAmount = user.reserveAmount.add(currentReserveAmount);
        user.lastReserveWithdrawTime = block.timestamp;

        emit ReserveWithdraw(msg.sender, currentReserveAmount, shares);
    }

    function withdraw() external whenNotPaused {
        UserInfo storage user = userInfo[msg.sender];
        uint256 withdrawAmount = user.reserveAmount;
        uint256 currentWithdrawFee = 0;
        if (block.timestamp < user.lastReserveWithdrawTime.add(withdrawFeePeriod)) {
            currentWithdrawFee = withdrawAmount.mul(withdrawFee).div(10000);
            TransferHelper.safeTransfer(address(stakedToken), treasury, currentWithdrawFee);
            withdrawAmount = withdrawAmount.sub(currentWithdrawFee);
        }
        totalReserveAmount = totalReserveAmount.sub(user.reserveAmount);
        user.reserveAmount = 0;

        TransferHelper.safeTransfer(address(stakedToken), msg.sender, withdrawAmount);

        emit Withdraw(msg.sender, withdrawAmount, currentWithdrawFee);
    }

    function instantWithdraw(uint256 shares) external whenNotPaused {
        require(shares <= balanceOf(msg.sender), 'WooStakingVault: shares exceed balance');

        uint256 withdrawAmount = shares.mulFloor(getPricePerFullShare());

        uint256 poolBalance = balance();
        if (poolBalance < withdrawAmount) {
            withdrawAmount = poolBalance;
        }

        _burn(msg.sender, shares); // _burn will check the balance of user's shares enough or not

        uint256 currentWithdrawFee = withdrawAmount.mul(withdrawFee).div(10000);
        if (currentWithdrawFee > 0) {
            TransferHelper.safeTransfer(address(stakedToken), treasury, currentWithdrawFee);
        }
        withdrawAmount = withdrawAmount.sub(currentWithdrawFee);

        TransferHelper.safeTransfer(address(stakedToken), msg.sender, withdrawAmount);

        emit InstantWithdraw(msg.sender, withdrawAmount, currentWithdrawFee);
    }

    /* ----- Public Functions ----- */

    function getPricePerFullShare() public view whenNotPaused returns (uint256) {
        if (totalSupply() == 0) {
            return 1e18;
        }
        return balance().mul(1e18).div(totalSupply());
    }

    function balance() public view whenNotPaused returns (uint256) {
        return stakedToken.balanceOf(address(this)).sub(totalReserveAmount);
    }

    /* ----- Private Functions ----- */

    function _updateCostSharePrice(uint256 amount, uint256 shares) private {
        uint256 sharesBefore = balanceOf(msg.sender);
        uint256 costBefore = costSharePrice[msg.sender];
        uint256 costAfter = (sharesBefore.mul(costBefore).add(amount.mul(1e18))).div(sharesBefore.add(shares));

        costSharePrice[msg.sender] = costAfter;
    }

    /* ----- Admin Functions ----- */

    /// @notice Sets withdraw fee period
    /// @dev Only callable by the contract owner.
    function setWithdrawFeePeriod(uint256 newWithdrawFeePeriod) external onlyOwner {
        require(
            newWithdrawFeePeriod <= MAX_WITHDRAW_FEE_PERIOD,
            'WooStakingVault: newWithdrawFeePeriod>MAX_WITHDRAW_FEE_PERIOD'
        );
        withdrawFeePeriod = newWithdrawFeePeriod;
    }

    /// @notice Sets withdraw fee
    /// @dev Only callable by the contract owner.
    function setWithdrawFee(uint256 newWithdrawFee) external onlyOwner {
        require(newWithdrawFee <= MAX_WITHDRAW_FEE, 'WooStakingVault: newWithdrawFee>MAX_WITHDRAW_FEE');
        withdrawFee = newWithdrawFee;
    }

    /// @notice Sets treasury address
    /// @dev Only callable by the contract owner.
    function setTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
    }

    /// @notice Pause the contract.
    function pause() external onlyOwner {
        super._pause();
    }

    /// @notice Restart the contract.
    function unpause() external onlyOwner {
        super._unpause();
    }
}