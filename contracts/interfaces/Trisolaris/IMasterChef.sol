// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IMasterChef {
    function deposit(uint256 pid, uint256 amount) external;

    function withdraw(uint256 pid, uint256 amount) external;

    function harvest(uint256 pid) external returns (address);

    function emergencyWithdraw(uint256 pid) external;

    function pendingTri(uint256 pid, address user) external view returns (uint256);

    function poolInfo(uint256 pid)
        external
        view
        returns (
            address,
            uint256,
            uint256,
            uint256
        );

    function userInfo(uint256 pid, address user) external view returns (uint256, uint256);
}
