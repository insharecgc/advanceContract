// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 辅助合约：测试ETH接收
contract TestWallet {
  receive() external payable {}
}