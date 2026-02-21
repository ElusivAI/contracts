// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Helper to send ETH to a contract that has no receive/fallback (e.g. for tests).
contract ForceSendEth {
  function destroy(address payable target) external payable {
    selfdestruct(target);
  }
}
