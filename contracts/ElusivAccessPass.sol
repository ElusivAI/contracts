// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/Strings.sol';

/// @title Elusiv Access Pass
/// @notice An ERC721 token that grants access to Elusiv features.
/// @dev Implements a paid minting mechanism with a max supply and per-wallet limit.
contract ElusivAccessPass is ERC721, Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;
  using Strings for uint256;

  uint256 public constant MAX_PER_WALLET = 1;
  uint96 public constant AFFILIATE_FEE_ABSOLUTE_MAX = 5_000; // hard ceiling to protect treasury

  uint256 public nextTokenId;
  uint256 public maxSupply;
  bool public mintingEnabled;
  uint256 public mintPrice;
  address payable public treasury;
  string public baseTokenURI;

  IERC20 public elusivToken;
  uint96 public maxAffiliateFeeBps;
  uint96 public defaultAffiliateFeeBps;
  uint256 public defaultTokenReward;
  bool public allowSelfReferral;
  bool public tokenRewardsEnabled;

  struct Promo {
    address affiliate;
    uint96 feeBps;
    uint256 tokenReward;
    bool active;
  }

  string private constant _name = 'Elusiv Access Pass';
  string private constant _symbol = 'ELUSIVPASS';
  string private constant _creator = 'Elusiv Labs';
  string private constant _defaultBaseTokenURI = 'https://elusiv.ai/nftassets/v1/alpha.jpg';

  mapping(address => uint256) private _mintedBy;
  mapping(bytes32 => Promo) private _promos;

  event MintingStatusUpdated(bool enabled, address indexed updater);
  event MaxSupplyUpdated(uint256 maxSupply, address indexed updater);
  event MintPriceUpdated(uint256 mintPrice, address indexed updater);
  event TreasuryUpdated(address treasury, address indexed updater);
  event BaseURIUpdated(string baseURI, address indexed updater);
  event PassMinted(address indexed to, uint256 indexed tokenId);
  event FundsWithdrawn(address indexed to, uint256 amount, address indexed executor);
  event AffiliateSettingsUpdated(
    uint96 maxAffiliateFeeBps,
    uint96 defaultAffiliateFeeBps,
    uint256 defaultTokenReward,
    address elusivToken,
    bool allowSelfReferral,
    bool tokenRewardsEnabled,
    address indexed updater
  );
  event PromoCreated(bytes32 indexed code, address indexed affiliate, uint96 feeBps, uint256 tokenReward);
  event PromoUpdated(bytes32 indexed code, address indexed affiliate, uint96 feeBps, uint256 tokenReward, bool active);
  event PromoDisabled(bytes32 indexed code);
  event PromoUsed(
    bytes32 indexed code,
    address indexed buyer,
    address indexed affiliate,
    uint256 affiliateEth,
    uint256 tokenReward
  );

  error MintClosed();
  error SoldOut();
  error MintLimitReached();
  error InvalidTreasury();
  error MintPriceRequired();
  error IncorrectMintPayment();
  error EtherNotAccepted();
  error InvalidPromoCode();
  error AffiliateFeeTooHigh();
  error SelfReferralNotAllowed();
  error TokenRewardsUnavailable();
  error InvalidRewardToken();
  error PromoAlreadyExists();
  error PromoRequiresPass();

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
    maxAffiliateFeeBps = 1_000; // 10% default ceiling
    defaultAffiliateFeeBps = 1_000;
    defaultTokenReward = 0;
    allowSelfReferral = false;
    tokenRewardsEnabled = true;

    emit MaxSupplyUpdated(initialMaxSupply, msg.sender);
    emit MintingStatusUpdated(initialMintingEnabled, msg.sender);
    emit MintPriceUpdated(initialMintPrice, msg.sender);
    emit TreasuryUpdated(initialTreasury, msg.sender);
    emit BaseURIUpdated(_defaultBaseTokenURI, msg.sender);
    emit AffiliateSettingsUpdated(
      maxAffiliateFeeBps,
      defaultAffiliateFeeBps,
      defaultTokenReward,
      address(0),
      allowSelfReferral,
      tokenRewardsEnabled,
      msg.sender
    );
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
  function publicMint(bytes32 promoCode) external payable canMint nonReentrant {
    _publicMint(promoCode);
  }

  /// @notice Backwards-compatible public mint without a promo code.
  function publicMint() external payable canMint nonReentrant {
    _publicMint(bytes32(0));
  }

  function _publicMint(bytes32 promoCode) internal {
    if (_mintedBy[msg.sender] >= MAX_PER_WALLET) revert MintLimitReached();
    _mintedBy[msg.sender] += 1;
    _distributeMintPayment(promoCode);
    _mintPass(msg.sender);
  }

  function _mintPass(address to) internal {
    if (nextTokenId >= maxSupply) revert SoldOut();
    require(to != address(0), 'Invalid recipient');
    uint256 tokenId = nextTokenId++;
    _safeMint(to, tokenId);
    emit PassMinted(to, tokenId);
  }

  function _distributeMintPayment(bytes32 promoCode) internal {
    if (mintPrice == 0) revert MintPriceRequired();
    if (msg.value != mintPrice) revert IncorrectMintPayment();

    uint256 affiliateAmount;
    uint256 tokenReward;
    address affiliate;

    if (promoCode != bytes32(0)) {
      Promo memory promo = _promos[promoCode];
      if (!promo.active || promo.affiliate == address(0)) revert InvalidPromoCode();
      if (!allowSelfReferral && promo.affiliate == msg.sender) revert SelfReferralNotAllowed();
      affiliateAmount = (msg.value * promo.feeBps) / 10_000;
      tokenReward = promo.tokenReward;
      affiliate = promo.affiliate;

      if (affiliateAmount > 0) {
        (bool sentAffiliate, ) = payable(affiliate).call{ value: affiliateAmount }('');
        require(sentAffiliate, 'Affiliate transfer failed');
      }

      if (tokenRewardsEnabled && tokenReward > 0 && address(elusivToken) != address(0)) {
        if (elusivToken.balanceOf(address(this)) < tokenReward) revert TokenRewardsUnavailable();
        elusivToken.safeTransfer(affiliate, tokenReward);
      }

      emit PromoUsed(promoCode, msg.sender, affiliate, affiliateAmount, tokenReward);
    }

    uint256 treasuryAmount = msg.value - affiliateAmount;
    (bool sentTreasury, ) = treasury.call{ value: treasuryAmount }('');
    require(sentTreasury, 'Treasury transfer failed');
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

  /// @notice Updates affiliate-related settings.
  /// @dev When rewardsEnabled is false, tokenAddress may be zero. Contract must hold enough ELUSIV for active promos or mints with token rewards will revert with TokenRewardsUnavailable. Affiliate is paid first; a reverting affiliate contract can DoS the mint.
  /// @param newMaxAffiliateFeeBps Maximum fee split allowed for promos (in bps).
  /// @param newDefaultAffiliateFeeBps Default fee bps for holder-created promos.
  /// @param newDefaultTokenReward Default token reward for new promos.
  /// @param tokenAddress ERC20 token address for rewards (set zero address to disable).
  /// @param selfReferralAllowed Whether buyer can be the affiliate.
  /// @param rewardsEnabled Whether token rewards are enabled.
  function setAffiliateSettings(
    uint96 newMaxAffiliateFeeBps,
    uint96 newDefaultAffiliateFeeBps,
    uint256 newDefaultTokenReward,
    address tokenAddress,
    bool selfReferralAllowed,
    bool rewardsEnabled
  ) external onlyOwner {
    if (newMaxAffiliateFeeBps > AFFILIATE_FEE_ABSOLUTE_MAX) revert AffiliateFeeTooHigh();
    if (newDefaultAffiliateFeeBps > newMaxAffiliateFeeBps) revert AffiliateFeeTooHigh();
    if (rewardsEnabled && tokenAddress == address(0)) revert InvalidRewardToken();
    maxAffiliateFeeBps = newMaxAffiliateFeeBps;
    defaultAffiliateFeeBps = newDefaultAffiliateFeeBps;
    defaultTokenReward = newDefaultTokenReward;
    elusivToken = IERC20(tokenAddress);
    allowSelfReferral = selfReferralAllowed;
    tokenRewardsEnabled = rewardsEnabled;
    emit AffiliateSettingsUpdated(
      newMaxAffiliateFeeBps,
      newDefaultAffiliateFeeBps,
      newDefaultTokenReward,
      tokenAddress,
      selfReferralAllowed,
      rewardsEnabled,
      msg.sender
    );
  }

  /// @notice Creates or updates a promo code configuration.
  /// @param code The promo code (bytes32, recommend hashing normalized string).
  /// @param affiliate The affiliate address receiving rewards.
  /// @param feeBps Affiliate share in basis points.
  /// @param tokenReward Token reward per mint for this promo.
  /// @param active Whether the promo is active.
  function setPromoCode(bytes32 code, address affiliate, uint96 feeBps, uint256 tokenReward, bool active) external onlyOwner {
    _setPromoCode(code, affiliate, feeBps, tokenReward, active);
  }

  /// @notice Creates or updates a promo code using the default token reward value.
  /// @param code The promo code (bytes32, recommend hashing normalized string).
  /// @param affiliate The affiliate address receiving rewards.
  /// @param feeBps Affiliate share in basis points.
  /// @param active Whether the promo is active.
  function setPromoCodeWithDefault(bytes32 code, address affiliate, uint96 feeBps, bool active) external onlyOwner {
    _setPromoCode(code, affiliate, feeBps, defaultTokenReward, active);
  }

  /// @notice Allows an access pass holder to register their own promo code once.
  /// @param codeString The human-readable code (recommended uppercase). Hashed with keccak256.
  function registerPromoCode(string calldata codeString) external {
    if (balanceOf(msg.sender) == 0) revert PromoRequiresPass();
    bytes memory raw = bytes(codeString);
    if (raw.length == 0) revert InvalidPromoCode();
    bytes32 code = keccak256(raw);
    if (_promos[code].affiliate != address(0)) revert PromoAlreadyExists();
    _setPromoCode(code, msg.sender, defaultAffiliateFeeBps, defaultTokenReward, true);
  }

  function _setPromoCode(bytes32 code, address affiliate, uint96 feeBps, uint256 tokenReward, bool active) internal {
    if (code == bytes32(0)) revert InvalidPromoCode();
    if (affiliate == address(0)) revert InvalidPromoCode();
    if (feeBps > maxAffiliateFeeBps || feeBps > AFFILIATE_FEE_ABSOLUTE_MAX) revert AffiliateFeeTooHigh();

    bool existed = _promos[code].affiliate != address(0);
    _promos[code] = Promo({ affiliate: affiliate, feeBps: feeBps, tokenReward: tokenReward, active: active });

    if (existed) {
      emit PromoUpdated(code, affiliate, feeBps, tokenReward, active);
    } else {
      emit PromoCreated(code, affiliate, feeBps, tokenReward);
    }
  }

  /// @notice Disables a promo code.
  /// @param code The promo code to disable.
  function disablePromoCode(bytes32 code) external onlyOwner {
    Promo storage promo = _promos[code];
    if (promo.affiliate == address(0)) revert InvalidPromoCode();
    promo.active = false;
    emit PromoDisabled(code);
  }

  /// @notice Returns the details of a promo code.
  /// @dev Treat affiliate == address(0) as "no promo" for unknown or disabled codes.
  /// @param code The promo code.
  function getPromoCode(bytes32 code) external view returns (Promo memory) {
    return _promos[code];
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
