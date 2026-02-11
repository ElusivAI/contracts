// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

/// @title Elusiv Token
/// @notice The native governance and utility token of the Elusiv ecosystem.
/// @dev Fixed supply token minted entirely to a treasury upon deployment. No owner-only functions; treasury must be an EOA or a contract that accepts ERC20 transfers (deployment will revert otherwise).
contract ElusivToken is ERC20 {
  string private constant _name = 'Elusiv Token';
  string private constant _symbol = 'ELUSIV';
  uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

  /// @notice Deploys the token and mints the full supply to the treasury.
  /// @param treasury The address to receive the initial supply. Must accept ERC20 (EOA or non-reverting contract).
  constructor(address treasury) ERC20(_name, _symbol) {
    require(treasury != address(0), 'Invalid treasury');
    _mint(treasury, INITIAL_SUPPLY);
  }
}
