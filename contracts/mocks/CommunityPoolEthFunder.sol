// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CommunityPoolEthFunder {
    function fund(address payable target) external payable {
        selfdestruct(target);
    }
}
