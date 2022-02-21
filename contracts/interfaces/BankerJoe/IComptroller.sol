// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IComptroller {
    function claimComp(address holder, address[] calldata _iTokens) external;
    function claimComp(address holder) external;
    function compAccrued(address holder) view external returns (uint256 comp);
    function enterMarkets(address[] memory _iTokens) external;
    function pendingComptrollerImplementation() view external returns (address implementation);
    function pendingImplementation() view external returns (address implementation);
    function claimReward(uint8 rewardType, address holder) external;
}
