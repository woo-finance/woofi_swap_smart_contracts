// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Pausable.sol';
import '@uniswap/lib/contracts/libraries/TransferHelper.sol';

import '../../../interfaces/BankerJoe/IJoeRouter.sol';
import '../../../interfaces/BankerJoe/IVToken.sol';
import '../../../interfaces/BankerJoe/IComptroller.sol';
import '../../../interfaces/IWooAccessManager.sol';
import '../../../interfaces/IWETH.sol';
import '../BaseStrategy.sol';

contract StrategyBankerJoe is BaseStrategy {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /* ----- State Variables ----- */

    address public iToken;
    address[] public rewardToWantRoute;
    uint256 public lastHarvest;
    uint256 public supplyBal;

    /* ----- Constant Variables ----- */

    address public constant wrappedEther = address(0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7);  // WAVAX
    address public constant reward = address(0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd);        // JOE
    address public constant uniRouter = address(0x60aE616a2155Ee3d9A68541Ba4544862310933d4);     // JoeRouter
    address public constant comptroller = address(0xdc13687554205E5b89Ac783db14bb5bba4A1eDaC);

    /* ----- Events ----- */

    event StratHarvest(address indexed harvester, uint256 wantHarvested, uint256 tvl);
    event Deposit(uint256 tvl);
    event Withdraw(uint256 tvl);

    constructor(
        address initVault,
        address initAccessManager,
        address initIToken,
        address[] memory initRewardToWantRoute
    ) public BaseStrategy(initVault, initAccessManager) {
        iToken = initIToken;
        rewardToWantRoute = initRewardToWantRoute;

        _giveAllowances();
    }

    /* ----- External Functions ----- */

    function beforeDeposit() public override {
        super.beforeDeposit();
        updateSupplyBal();
    }

    function rewardToWant() external view returns (address[] memory) {
        return rewardToWantRoute;
    }

    /* ----- Public Functions ----- */

    function harvest() public override whenNotPaused {
        require(msg.sender == tx.origin || msg.sender == address(vault), 'StrategyBankerJoeNative: EOA_or_vault');

        // When pendingImplementation not zero address, means there is a new implement ready to replace.
        if (IComptroller(comptroller).pendingImplementation() == address(0)) {
            uint256 beforeBal = balanceOfWant();

            IComptroller(comptroller).claimReward(0, address(this));
            IComptroller(comptroller).claimReward(1, address(this));
            uint256 toWrap = address(this).balance;
            if (toWrap > 0) {
                IWETH(wrappedEther).deposit{value: toWrap}();
            }

            uint256 rewardBal = IERC20(reward).balanceOf(address(this));
            if (rewardBal > 0) {
                IJoeRouter(uniRouter).swapExactTokensForTokens(rewardBal, 0, rewardToWantRoute, address(this), now);
                uint256 wantHarvested = balanceOfWant().sub(beforeBal);
                uint256 fee = chargePerformanceFee(wantHarvested);
                deposit();

                lastHarvest = block.timestamp;
                emit StratHarvest(msg.sender, wantHarvested.sub(fee), balanceOf());
            }
        } else {
            _withdrawAll();
            pause();
        }
    }

    function deposit() public override whenNotPaused nonReentrant {
        uint256 wantBal = balanceOfWant();

        if (wantBal > 0) {
            IVToken(iToken).mint(wantBal);
            updateSupplyBal();
            emit Deposit(balanceOf());
        }
    }

    function withdraw(uint256 amount) public override nonReentrant {
        require(msg.sender == vault, 'StrategyBankerJoeNative: !vault');
        require(amount > 0, 'StrategyBankerJoeNative: !amount');

        uint256 wantBal = balanceOfWant();

        if (wantBal < amount) {
            IVToken(iToken).redeemUnderlying(amount.sub(wantBal));
            updateSupplyBal();
            uint256 newWantBal = IERC20(want).balanceOf(address(this));
            require(newWantBal > wantBal, 'StrategyBankerJoeNative: !newWantBal');
            wantBal = newWantBal;
        }

        uint256 withdrawAmt = amount < wantBal ? amount : wantBal;

        uint256 fee = chargeWithdrawalFee(withdrawAmt);
        if (withdrawAmt > fee) {
            TransferHelper.safeTransfer(want, vault, withdrawAmt.sub(fee));
        }
        emit Withdraw(balanceOf());
    }

    function updateSupplyBal() public {
        supplyBal = IVToken(iToken).balanceOfUnderlying(address(this));
    }

    function balanceOfPool() public view override returns (uint256) {
        return supplyBal;
    }

    /* ----- Internal Functions ----- */

    function _giveAllowances() internal override {
        TransferHelper.safeApprove(want, iToken, 0);
        TransferHelper.safeApprove(want, iToken, uint256(-1));
        TransferHelper.safeApprove(reward, uniRouter, 0);
        TransferHelper.safeApprove(reward, uniRouter, uint256(-1));
        TransferHelper.safeApprove(wrappedEther, uniRouter, 0);
        TransferHelper.safeApprove(wrappedEther, uniRouter, uint256(-1));
    }

    function _removeAllowances() internal override {
        TransferHelper.safeApprove(want, iToken, 0);
        TransferHelper.safeApprove(reward, uniRouter, 0);
        TransferHelper.safeApprove(wrappedEther, uniRouter, 0);
    }

    function _withdrawAll() internal {
        uint256 iTokenBal = IERC20(iToken).balanceOf(address(this));
        if (iTokenBal > 0) {
            IVToken(iToken).redeem(iTokenBal);
        }
        updateSupplyBal();
    }

    /* ----- Admin Functions ----- */

    function retireStrat() external override {
        require(msg.sender == vault, 'StrategyBankerJoeNative: !vault');
        _withdrawAll();
        uint256 wantBal = IERC20(want).balanceOf(address(this));
        if (wantBal > 0) {
            TransferHelper.safeTransfer(want, vault, wantBal);
        }
    }

    function emergencyExit() external override onlyAdmin {
        _withdrawAll();
        uint256 wantBal = IERC20(want).balanceOf(address(this));
        if (wantBal > 0) {
            TransferHelper.safeTransfer(want, vault, wantBal);
        }
    }

    receive() external payable {}
}
