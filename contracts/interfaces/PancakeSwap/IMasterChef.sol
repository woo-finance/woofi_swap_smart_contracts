// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IMasterChef {
    function deposit(uint256 pid, uint256 amount) external;
    function withdraw(uint256 pid, uint256 amount) external;
    function enterStaking(uint256 amount) external;
    function leaveStaking(uint256 amount) external;
    function emergencyWithdraw(uint256 pid) external;
    function pendingCake(uint256 pid, address user) external view returns (uint256);
    function poolInfo(uint pid) external view returns (address, uint256, uint256, uint256);
    function userInfo(uint256 pid, address user) external view returns (uint256, uint256);
}
