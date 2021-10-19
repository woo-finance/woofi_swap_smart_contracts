// SPDX-License-Identifier: MIT
pragma solidity =0.6.12;
pragma experimental ABIEncoderV2;

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
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
*/

/// @title Woo private pool for swap.
/// @notice Use this contract to directly interfact with woo's synthetic proactive
///         marketing making pool.
/// @author woo.network
interface IWooPP {
    /* ----- Type declarations ----- */

    /// @dev struct info to store the token info
    struct TokenInfo {
        uint112 reserve;            // Token balance
        uint112 threshold;          // Threshold for reserve update
        uint32 lastResetTimestamp;  // Timestamp for last param update
        uint64 lpFeeRate;           // Fee rate: e.g. 0.001 = 0.1%
        uint64 R;                   // Rebalance coefficient [0, 1]
        uint112 target;             // Targeted balance for pricing
        address chainlinkRefOracle; // chainlink oracle for price checking
        uint96 refPriceFixCoeff;    //
        bool isValid;
    }

    /* ----- Events ----- */

    event StrategistUpdated(address indexed strategist, bool flag);
    event RewardManagerUpdated(address indexed newRewardManager);
    event WooracleUpdated(address indexed newWooracle);
    event ChainlinkRefOracleUpdated(address indexed token, address indexed newChainlinkRefOracle);
    event ParametersUpdated(address indexed baseToken, uint256 newThreshold, uint256 newLpFeeRate, uint256 newR);
    event Withdraw(address indexed token, address indexed to, uint256 amount);
    event WooSwap(
        address indexed fromToken,
        address indexed toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address from,
        address indexed to
    );

    /* ----- External Functions ----- */

    /// @dev Swap baseToken into quoteToken
    /// @param baseToken TODO
    /// @param baseAmount amount of baseToken that user want to swap
    /// @param minQuoteAmount minimum amount of quoteToken that user accept to receive
    /// @param to quoteToken receiver address
    /// @param rebateTo TODO
    /// @return quoteAmount TODO
    function sellBase(
        address baseToken,
        uint256 baseAmount,
        uint256 minQuoteAmount,
        address to,
        address rebateTo
    ) external returns (uint256 quoteAmount);

    /// @dev Swap quoteToken into baseToken
    /// @param baseToken TODO
    /// @param quoteAmount amount of quoteToken that user want to swap
    /// @param minBaseAmount minimum amount of baseToken that user accept to receive
    /// @param to baseToken receiver address
    /// @param rebateTo TODO
    /// @return baseAmount TODO
    function sellQuote(
        address baseToken,
        uint256 quoteAmount,
        uint256 minBaseAmount,
        address to,
        address rebateTo
    ) external returns (uint256 baseAmount);

    /// @dev TODO
    /// @param baseToken TODO
    /// @param baseAmount TODO
    /// @return quoteAmount TODO
    function querySellBase(address baseToken, uint256 baseAmount) external view returns (uint256 quoteAmount);

    /// @dev TODO
    /// @param baseToken TODO
    /// @param quoteAmount TODO
    /// @return baseAmount TODO
    function querySellQuote(address baseToken, uint256 quoteAmount) external view returns (uint256 baseAmount);

    /// @dev get quote token address
    /// @return address of quote token
    function quoteToken() external view returns (address);
}
