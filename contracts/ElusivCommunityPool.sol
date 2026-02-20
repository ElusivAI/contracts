// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @title Elusiv Community Pool
/// @notice Manages the community reward pool for independent contributions.
/// @dev Holds ELUSIV tokens and allows authorized withdrawals by the Contribution Desk.
contract ElusivCommunityPool is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  IERC20 public immutable elusivToken;
  address public contributionDesk;

  event Deposit(address indexed depositor, uint256 amount);
  event Withdrawal(address indexed to, uint256 amount, address indexed executor);
  event EmergencyWithdrawal(address indexed token, address indexed to, uint256 amount, address indexed executor);
  event ContributionDeskUpdated(address indexed newDesk);

  error InvalidAddress();
  error NotAuthorized();
  error InsufficientBalance();
  error InvalidAmount();
  error ContributionDeskNotSet();

  /// @notice Initializes the community pool.
  /// @param tokenAddress The ELUSIV token contract address.
  constructor(address tokenAddress) Ownable(msg.sender) {
    require(tokenAddress != address(0), 'Token required');
    elusivToken = IERC20(tokenAddress);
  }

  /// @notice Set the contribution desk address (authorized to withdraw).
  /// @param desk The contribution desk contract address.
  function setContributionDesk(address desk) external onlyOwner {
    if (desk == address(0)) revert InvalidAddress();
    contributionDesk = desk;
    emit ContributionDeskUpdated(desk);
  }

  /// @notice Deposit tokens to the pool.
  /// @param amount The amount of tokens to deposit.
  function deposit(uint256 amount) external nonReentrant {
    require(amount > 0, 'Amount must be > 0');
    elusivToken.safeTransferFrom(msg.sender, address(this), amount);
    emit Deposit(msg.sender, amount);
  }

  /// @notice Withdraw tokens from the pool (authorized addresses only).
  /// @param to The recipient address.
  /// @param amount The amount of tokens to withdraw.
  function withdraw(address to, uint256 amount) external nonReentrant {
    if (contributionDesk == address(0)) revert ContributionDeskNotSet();
    if (msg.sender != contributionDesk && msg.sender != owner()) {
      revert NotAuthorized();
    }
    if (to == address(0)) revert InvalidAddress();
    if (amount == 0) revert InvalidAmount();

    uint256 balance = elusivToken.balanceOf(address(this));
    if (balance < amount) revert InsufficientBalance();

    elusivToken.safeTransfer(to, amount);
    emit Withdrawal(to, amount, msg.sender);
  }

  /// @notice Get the current pool balance.
  /// @return balance The current balance of tokens in the pool.
  function getBalance() external view returns (uint256 balance) {
    return elusivToken.balanceOf(address(this));
  }

  /// @notice Emergency withdrawal by owner (for safety).
  /// @dev Use only in emergencies; restrict owner to a trusted multisig or governance.
  ///      Allows withdrawal of any ERC-20 token or ETH (when token is address(0)),
  ///      useful for recovering tokens or ETH sent by accident.
  /// @param token The ERC-20 token contract address to withdraw, or address(0) for ETH.
  /// @param to The recipient address.
  /// @param amount The amount of tokens or ETH to withdraw.
  function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
    if (to == address(0)) revert InvalidAddress();
    if (amount == 0) revert InvalidAmount();

    if (token == address(0)) {
      // Withdraw ETH
      uint256 balance = address(this).balance;
      if (balance < amount) revert InsufficientBalance();
      (bool success, ) = payable(to).call{ value: amount }('');
      require(success, 'ETH transfer failed');
    } else {
      // Withdraw ERC-20 token
      IERC20 tokenContract = IERC20(token);
      uint256 balance = tokenContract.balanceOf(address(this));
      if (balance < amount) revert InsufficientBalance();
      tokenContract.safeTransfer(to, amount);
    }

    emit EmergencyWithdrawal(token, to, amount, msg.sender);
  }
}
