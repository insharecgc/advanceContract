// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./NewMetaNodeStake.sol";

contract NewMetaNodeStakeV2 is NewMetaNodeStake{
    function newFun() public pure returns (string memory){
        return "newFun";
    }
}