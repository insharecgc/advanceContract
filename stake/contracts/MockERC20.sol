// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        // 初始供应量可以在这里定义，或者留空以便之后通过 mint 函数铸造
        _mint(msg.sender, 100000000 * 10 ** 18);
    }

    function mint(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }
}
