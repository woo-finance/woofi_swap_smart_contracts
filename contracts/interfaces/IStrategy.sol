// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IStrategy {
    function vault() external view returns (address);

    function want() external view returns (address);

    function beforeDeposit() external;

    function deposit() external;

    function withdraw(uint256) external;

    function balanceOf() external view returns (uint256);

    function balanceOfWant() external view returns (uint256);

    function balanceOfPool() external view returns (uint256);

    function harvest() external;

    function retireStrat() external;

    function emergencyExit() external;

    function paused() external view returns (bool);
}
