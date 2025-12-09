// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/Strings.sol';

/// @title Elusiv Access Pass
/// @notice An ERC721 token that grants access to Elusiv features.
/// @dev Implements a paid minting mechanism with a max supply and per-wallet limit.
contract ElusivAccessPass is ERC721, Ownable, ReentrancyGuard {
  using Strings for uint256;

  uint256 public constant MAX_PER_WALLET = 1;

  uint256 public nextTokenId;
  uint256 public maxSupply;
  bool public mintingEnabled;
  uint256 public mintPrice;
  address payable public treasury;
  string public baseTokenURI;

  string private constant _name = 'Elusiv Access Pass';
  string private constant _symbol = 'ELSVPASS';
  string private constant _creator = 'Elusiv Labs';
  string private constant _defaultBaseTokenURI = 'https://elusiv.ai/nftassets/v1/alpha.jpg';

  mapping(address => uint256) private _mintedBy;

  event MintingStatusUpdated(bool enabled, address indexed updater);
  event MaxSupplyUpdated(uint256 maxSupply, address indexed updater);
  event MintPriceUpdated(uint256 mintPrice, address indexed updater);
  event TreasuryUpdated(address treasury, address indexed updater);
  event BaseURIUpdated(string baseURI, address indexed updater);
  event PassMinted(address indexed to, uint256 indexed tokenId);
  event FundsWithdrawn(address indexed to, uint256 amount, address indexed executor);

  error MintClosed();
  error SoldOut();
  error MintLimitReached();
  error InvalidTreasury();
  error MintPriceRequired();
  error IncorrectMintPayment();
  error EtherNotAccepted();

  /// @notice Initializes the access pass contract.
  /// @param initialMaxSupply The maximum number of tokens that can ever be minted.
  /// @param initialMintingEnabled Whether minting is enabled immediately upon deployment.
  /// @param initialMintPrice The price in wei to mint a pass.
  /// @param initialTreasury The address that receives minting proceeds.
  constructor(
    uint256 initialMaxSupply,
    bool initialMintingEnabled,
    uint256 initialMintPrice,
    address payable initialTreasury
  ) ERC721(_name, _symbol) Ownable(msg.sender) {
    require(initialMaxSupply > 0, 'Max supply required');
    require(initialMintPrice > 0, 'Mint price required');
    if (initialTreasury == address(0)) revert InvalidTreasury();

    maxSupply = initialMaxSupply;
    mintingEnabled = initialMintingEnabled;
    mintPrice = initialMintPrice;
    treasury = initialTreasury;
    baseTokenURI = _defaultBaseTokenURI;

    emit MaxSupplyUpdated(initialMaxSupply, msg.sender);
    emit MintingStatusUpdated(initialMintingEnabled, msg.sender);
    emit MintPriceUpdated(initialMintPrice, msg.sender);
    emit TreasuryUpdated(initialTreasury, msg.sender);
    emit BaseURIUpdated(_defaultBaseTokenURI, msg.sender);
  }

  modifier canMint() {
    if (!mintingEnabled) revert MintClosed();
    if (nextTokenId >= maxSupply) revert SoldOut();
    _;
  }

  /// @notice Admin function to free-mint a pass to a specific address.
  /// @param to The recipient address.
  function mint(address to) external onlyOwner {
    _mintPass(to);
  }

  /// @notice Public function to mint a pass by paying the mint price.
  /// @dev Checks mint limits and transfers value to treasury.
  function publicMint() external payable canMint nonReentrant {
    if (_mintedBy[msg.sender] >= MAX_PER_WALLET) revert MintLimitReached();
    _mintedBy[msg.sender] += 1; // effects before interactions
    _collectMintPayment(); // checks payment and forwards value
    _mintPass(msg.sender);
  }

  function _mintPass(address to) internal {
    if (nextTokenId >= maxSupply) revert SoldOut();
    require(to != address(0), 'Invalid recipient');
    uint256 tokenId = nextTokenId++;
    _safeMint(to, tokenId);
    emit PassMinted(to, tokenId);
  }

  function _collectMintPayment() internal {
    if (mintPrice == 0) revert MintPriceRequired();
    if (msg.value != mintPrice) revert IncorrectMintPayment();
    (bool sent, ) = treasury.call{ value: msg.value }('');
    require(sent, 'Treasury transfer failed');
  }

  /// @notice Enables or disables public minting.
  /// @param enabled True to enable, false to disable.
  function setMintingEnabled(bool enabled) external onlyOwner {
    mintingEnabled = enabled;
    emit MintingStatusUpdated(enabled, msg.sender);
  }

  /// @notice Updates the maximum supply of tokens.
  /// @dev Cannot be set below the current number of minted tokens.
  /// @param newMaxSupply The new maximum supply.
  function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
    require(newMaxSupply >= nextTokenId, 'Cannot set max below minted');
    maxSupply = newMaxSupply;
    emit MaxSupplyUpdated(newMaxSupply, msg.sender);
  }

  /// @notice Updates the price to mint a token.
  /// @param newMintPrice The new price in wei.
  function setMintPrice(uint256 newMintPrice) external onlyOwner {
    if (newMintPrice == 0) revert MintPriceRequired();
    mintPrice = newMintPrice;
    emit MintPriceUpdated(newMintPrice, msg.sender);
  }

  /// @notice Updates the treasury address.
  /// @param newTreasury The new treasury address.
  function setTreasury(address payable newTreasury) external onlyOwner {
    if (newTreasury == address(0)) revert InvalidTreasury();
    treasury = newTreasury;
    emit TreasuryUpdated(newTreasury, msg.sender);
  }

  /// @notice Updates the base token URI used for metadata resolution.
  /// @param newBaseURI The new base URI.
  function setBaseURI(string calldata newBaseURI) external onlyOwner {
    baseTokenURI = newBaseURI;
    emit BaseURIUpdated(newBaseURI, msg.sender);
  }

  /// @notice Withdraws any stray Ether from the contract to the specified address.
  /// @dev Normally funds go directly to treasury during mint, this is for safety.
  /// @param to The recipient address.
  /// @param amount The amount to withdraw.
  function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
    if (to == address(0)) revert InvalidTreasury();
    uint256 balance = address(this).balance;
    require(amount <= balance, 'Insufficient balance');
    (bool sent, ) = to.call{ value: amount }('');
    require(sent, 'Withdraw failed');
    emit FundsWithdrawn(to, amount, msg.sender);
  }

  /// @notice Returns the number of tokens minted by a specific wallet.
  /// @param wallet The wallet address to check.
  function mintedCount(address wallet) external view returns (uint256) {
    return _mintedBy[wallet];
  }

  /// @notice Returns the number of tokens remaining to be minted.
  function remainingSupply() external view returns (uint256) {
    if (maxSupply <= nextTokenId) return 0;
    return maxSupply - nextTokenId;
  }

  /// @notice Returns the creator string.
  function creator() external pure returns (string memory) {
    return _creator;
  }

  /// @inheritdoc ERC721
  function tokenURI(uint256 tokenId) public view override returns (string memory) {
    _requireOwned(tokenId);
    if (bytes(baseTokenURI).length == 0) return '';
    bytes memory uriBytes = bytes(baseTokenURI);
    if (uriBytes[uriBytes.length - 1] == '/') {
      return string.concat(baseTokenURI, tokenId.toString());
    }
    return baseTokenURI;
  }

  receive() external payable {
    revert EtherNotAccepted();
  }
}
