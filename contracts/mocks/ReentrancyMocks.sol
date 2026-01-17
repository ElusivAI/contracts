// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '../ElusivAccessPass.sol';
import '../ElusivResearchDesk.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

/// @notice Treasury that attempts to reenter AccessPass during payment receive.
contract ReenteringTreasury {
  ElusivAccessPass public pass;
  bool public attempted;

  constructor(address payable passAddress) {
    pass = ElusivAccessPass(passAddress);
  }

  receive() external payable {
    if (attempted) return;
    attempted = true;
    // attempt to reenter mint; should revert due to nonReentrant
    pass.publicMint{ value: msg.value }();
  }
}

/// @notice ERC20 mock that attempts to reenter ResearchDesk on transferFrom.
contract ReenteringToken is ERC20 {
  ElusivResearchDesk public desk;
  string private _query;

  constructor() ERC20('Reenter', 'RNT') {}

  function configure(address deskAddress, string memory query) external {
    desk = ElusivResearchDesk(deskAddress);
    _query = query;
  }

  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
    bool ok = super.transferFrom(from, to, amount);
    if (address(desk) != address(0)) {
      // attempt to reenter the research desk during token transfer
      desk.requestResearch(_query);
    }
    return ok;
  }
}




