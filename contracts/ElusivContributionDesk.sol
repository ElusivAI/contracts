// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

interface ICommunityPool {
  function withdraw(address to, uint256 amount) external;
}

/// @title Elusiv Contribution Desk
/// @notice Manages independent research contributions, validator system, and rewards.
/// @dev Allows users to submit research contributions without requests, validated by multiple validators.
contract ElusivContributionDesk is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  uint256 public constant DEFAULT_REVIEW_PERIOD = 7 days;
  uint256 public constant DEFAULT_MIN_VALIDATORS = 3;
  uint256 public constant DEFAULT_MAX_VALIDATORS = 5;
  uint256 public constant MAX_TITLE_LENGTH = 256;
  uint256 public constant MAX_DESCRIPTION_LENGTH = 1024;

  enum ContributionStatus {
    Pending,
    UnderReview,
    Approved,
    Rejected,
    Disputed
  }

  enum ValidatorVote {
    None,
    Approve,
    Reject
  }

  struct IndependentContribution {
    address contributor;
    string title;
    string documentHash;
    string description;
    uint256 submittedAt;
    uint256 reviewDeadline;
    uint256 rewardAmount;
    ContributionStatus status;
    address[] validators;
    uint256 approvalCount;
    uint256 rejectionCount;
  }

  struct ValidatorVoteData {
    address validator;
    ValidatorVote vote;
    uint256 votedAt;
  }

  struct ContributorStats {
    address contributor;
    uint256 totalValue;
    uint256 contributionCount;
  }

  IERC20 public immutable elusivToken;
  address public communityPool;
  uint256 public reviewPeriod;
  uint256 public minValidatorsRequired;
  uint256 public maxValidators;
  
  mapping(address => bool) public validators;
  address[] private _validatorList;
  mapping(address => uint256) public contributorStats;
  IndependentContribution[] private _contributions;
  
  mapping(uint256 => mapping(address => ValidatorVote)) private _validatorVotes;
  mapping(uint256 => mapping(address => uint256)) private _validatorVoteTimestamps;
  mapping(uint256 => address[]) private _contributionValidators;
  uint256 private _nextValidatorIndex;

  event ContributionSubmitted(
    uint256 indexed contributionId,
    address indexed contributor,
    string title,
    string documentHash
  );
  event ValidatorVoted(
    uint256 indexed contributionId,
    address indexed validator,
    bool approved
  );
  event ContributionFinalized(
    uint256 indexed contributionId,
    bool approved,
    uint256 rewardAmount
  );
  event ValidatorAdded(address indexed validator);
  event ValidatorRemoved(address indexed validator);
  event RewardDistributed(
    uint256 indexed contributionId,
    address indexed contributor,
    uint256 amount
  );
  event ReviewPeriodUpdated(uint256 newPeriod);
  event MinValidatorsUpdated(uint256 newMin);
  event CommunityPoolUpdated(address newPool);

  error InvalidContribution();
  error InvalidValidator();
  error NotValidator();
  error ContributionNotUnderReview();
  error ReviewPeriodNotExpired();
  error ConsensusNotReached();
  error AlreadyVoted();
  error InvalidInput();
  error PoolInsufficientBalance();
  error InvalidPoolAddress();
  error ContributionAlreadyFinalized();

  /// @notice Initializes the contribution desk.
  /// @param tokenAddress The ELUSIV token contract address.
  /// @param initialReviewPeriod The initial review period in seconds (default: 7 days).
  /// @param initialMinValidators Minimum validators required for consensus.
  /// @param initialMaxValidators Maximum validators to assign per contribution.
  constructor(
    address tokenAddress,
    uint256 initialReviewPeriod,
    uint256 initialMinValidators,
    uint256 initialMaxValidators
  ) Ownable(msg.sender) {
    require(tokenAddress != address(0), 'Token required');
    elusivToken = IERC20(tokenAddress);
    reviewPeriod = initialReviewPeriod == 0 ? DEFAULT_REVIEW_PERIOD : initialReviewPeriod;
    minValidatorsRequired = initialMinValidators == 0 ? DEFAULT_MIN_VALIDATORS : initialMinValidators;
    maxValidators = initialMaxValidators == 0 ? DEFAULT_MAX_VALIDATORS : initialMaxValidators;
  }

  /// @notice Submit an independent research contribution.
  /// @param title The title of the contribution.
  /// @param documentHash The hash or identifier of the uploaded document.
  /// @param description Optional description of the contribution.
  /// @param rewardAmount The reward amount requested (can be 0 for fixed rewards).
  /// @return contributionId The unique ID of the created contribution.
  function submitContribution(
    string calldata title,
    string calldata documentHash,
    string calldata description,
    uint256 rewardAmount
  ) external returns (uint256 contributionId) {
    uint256 titleLength = bytes(title).length;
    uint256 descLength = bytes(description).length;
    uint256 docHashLength = bytes(documentHash).length;

    require(titleLength > 0, 'Title required');
    require(titleLength <= MAX_TITLE_LENGTH, 'Title too long');
    require(docHashLength > 0, 'Document hash required');
    require(descLength <= MAX_DESCRIPTION_LENGTH, 'Description too long');
    require(_validatorList.length >= minValidatorsRequired, 'Insufficient validators');

    contributionId = _contributions.length;
    uint256 deadline = block.timestamp + reviewPeriod;
    address[] memory assignedValidators = _assignValidators();
    _nextValidatorIndex = (_nextValidatorIndex + assignedValidators.length) % (_validatorList.length > 0 ? _validatorList.length : 1);

    _contributions.push(
      IndependentContribution({
        contributor: msg.sender,
        title: title,
        documentHash: documentHash,
        description: description,
        submittedAt: block.timestamp,
        reviewDeadline: deadline,
        rewardAmount: rewardAmount,
        status: ContributionStatus.UnderReview,
        validators: assignedValidators,
        approvalCount: 0,
        rejectionCount: 0
      })
    );

    _contributionValidators[contributionId] = assignedValidators;

    emit ContributionSubmitted(contributionId, msg.sender, title, documentHash);
  }

  /// @notice Validator votes on a contribution.
  /// @param contributionId The ID of the contribution.
  /// @param approve True to approve, false to reject.
  function validatorVote(uint256 contributionId, bool approve) external {
    IndependentContribution storage contrib = _getContribution(contributionId);
    
    if (contrib.status != ContributionStatus.UnderReview) {
      revert ContributionNotUnderReview();
    }
    if (!validators[msg.sender]) {
      revert NotValidator();
    }
    if (!_isAssignedValidator(contributionId, msg.sender)) {
      revert NotValidator();
    }
    if (_validatorVotes[contributionId][msg.sender] != ValidatorVote.None) {
      revert AlreadyVoted();
    }

    ValidatorVote vote = approve ? ValidatorVote.Approve : ValidatorVote.Reject;
    _validatorVotes[contributionId][msg.sender] = vote;
    _validatorVoteTimestamps[contributionId][msg.sender] = block.timestamp;

    if (approve) {
      contrib.approvalCount++;
    } else {
      contrib.rejectionCount++;
    }

    emit ValidatorVoted(contributionId, msg.sender, approve);

    if (block.timestamp >= contrib.reviewDeadline) {
      _checkAndFinalize(contributionId);
    }
  }

  /// @notice Finalize a contribution after review period expires.
  /// @param contributionId The ID of the contribution.
  function finalizeContribution(uint256 contributionId) external nonReentrant {
    IndependentContribution storage contrib = _getContribution(contributionId);
    
    if (contrib.status != ContributionStatus.UnderReview) {
      revert ContributionNotUnderReview();
    }
    if (block.timestamp < contrib.reviewDeadline) {
      revert ReviewPeriodNotExpired();
    }

    _checkAndFinalize(contributionId);
  }

  /// @notice Add a validator to the system.
  /// @param validator The validator address to add.
  function addValidator(address validator) external onlyOwner {
    if (validator == address(0)) revert InvalidValidator();
    if (validators[validator]) revert InvalidValidator();

    validators[validator] = true;
    _validatorList.push(validator);
    emit ValidatorAdded(validator);
  }

  /// @notice Remove a validator from the system.
  /// @param validator The validator address to remove.
  function removeValidator(address validator) external onlyOwner {
    if (!validators[validator]) revert InvalidValidator();

    validators[validator] = false;
    _removeFromValidatorList(validator);
    emit ValidatorRemoved(validator);
  }

  /// @notice Set the minimum validators required for consensus.
  /// @param min The new minimum validators required.
  function setMinValidatorsRequired(uint256 min) external onlyOwner {
    require(min > 0, 'Min must be > 0');
    require(min <= _validatorList.length, 'Min exceeds validator count');
    minValidatorsRequired = min;
    emit MinValidatorsUpdated(min);
  }

  /// @notice Set the review period duration.
  /// @param period The new review period in seconds.
  function setReviewPeriod(uint256 period) external onlyOwner {
    require(period > 0, 'Period must be > 0');
    reviewPeriod = period;
    emit ReviewPeriodUpdated(period);
  }

  /// @notice Set the community pool address.
  /// @param pool The community pool contract address.
  function setCommunityPool(address pool) external onlyOwner {
    if (pool == address(0)) revert InvalidPoolAddress();
    communityPool = pool;
    emit CommunityPoolUpdated(pool);
  }

  /// @notice Deposit tokens to the community pool.
  /// @param amount The amount of tokens to deposit.
  function depositToPool(uint256 amount) external nonReentrant {
    require(communityPool != address(0), 'Pool not set');
    require(amount > 0, 'Amount must be > 0');
    elusivToken.safeTransferFrom(msg.sender, communityPool, amount);
  }

  /// @notice Get the community pool balance.
  /// @return balance The current balance of the community pool.
  function getPoolBalance() external view returns (uint256 balance) {
    if (communityPool == address(0)) return 0;
    return elusivToken.balanceOf(communityPool);
  }

  /// @notice Get contributor statistics.
  /// @param contributor The contributor address.
  /// @return totalValue Total value contributed.
  /// @return contributionCount Number of approved contributions.
  function getContributorStats(address contributor) external view returns (uint256 totalValue, uint256 contributionCount) {
    totalValue = contributorStats[contributor];
    contributionCount = _getApprovedContributionCount(contributor);
  }

  /// @notice Get top contributors by value.
  /// @param limit Maximum number of contributors to return.
  /// @return topContributors Array of ContributorStats sorted by value.
  function getTopContributors(uint256 limit) external view returns (ContributorStats[] memory topContributors) {
    uint256 validatorCount = _validatorList.length;
    if (validatorCount == 0) {
      return new ContributorStats[](0);
    }

    address[] memory allContributors = new address[](_contributions.length);
    uint256 uniqueCount = 0;
    
    for (uint256 i = 0; i < _contributions.length; i++) {
      if (_contributions[i].status == ContributionStatus.Approved) {
        address contrib = _contributions[i].contributor;
        bool found = false;
        for (uint256 j = 0; j < uniqueCount; j++) {
          if (allContributors[j] == contrib) {
            found = true;
            break;
          }
        }
        if (!found) {
          allContributors[uniqueCount] = contrib;
          uniqueCount++;
        }
      }
    }

    ContributorStats[] memory stats = new ContributorStats[](uniqueCount);
    for (uint256 i = 0; i < uniqueCount; i++) {
      stats[i] = ContributorStats({
        contributor: allContributors[i],
        totalValue: contributorStats[allContributors[i]],
        contributionCount: _getApprovedContributionCount(allContributors[i])
      });
    }

    _sortContributorsByValue(stats);

    uint256 resultLength = limit < uniqueCount ? limit : uniqueCount;
    topContributors = new ContributorStats[](resultLength);
    for (uint256 i = 0; i < resultLength; i++) {
      topContributors[i] = stats[i];
    }
  }

  /// @notice Get a contribution by ID.
  /// @param contributionId The contribution ID.
  /// @return contrib The contribution data.
  function getContribution(uint256 contributionId) external view returns (IndependentContribution memory contrib) {
    contrib = _getContribution(contributionId);
  }

  /// @notice Get validator votes for a contribution.
  /// @param contributionId The contribution ID.
  /// @return votes Array of validator vote data.
  function getValidatorVotes(uint256 contributionId) external view returns (ValidatorVoteData[] memory votes) {
    address[] memory assignedValidators = _contributionValidators[contributionId];
    votes = new ValidatorVoteData[](assignedValidators.length);
    
    for (uint256 i = 0; i < assignedValidators.length; i++) {
      votes[i] = ValidatorVoteData({
        validator: assignedValidators[i],
        vote: _validatorVotes[contributionId][assignedValidators[i]],
        votedAt: _validatorVoteTimestamps[contributionId][assignedValidators[i]]
      });
    }
  }

  /// @notice Get total number of contributions.
  /// @return count Total contributions.
  function totalContributions() external view returns (uint256 count) {
    return _contributions.length;
  }

  /// @notice Returns a paginated list of contributions.
  /// @param offset The starting index.
  /// @param limit The number of contributions to return.
  /// @return results Array of contributions.
  function getContributions(uint256 offset, uint256 limit) external view returns (IndependentContribution[] memory results) {
    uint256 total = _contributions.length;
    if (offset >= total) {
      return new IndependentContribution[](0);
    }
    uint256 end = offset + limit;
    if (end > total) end = total;
    uint256 length = end - offset;
    results = new IndependentContribution[](length);
    for (uint256 i = 0; i < length; i++) {
      results[i] = _contributions[offset + i];
    }
  }

  /// @notice Get list of all validators.
  /// @return validatorList Array of validator addresses.
  function getValidators() external view returns (address[] memory validatorList) {
    return _validatorList;
  }

  function _getContribution(uint256 contributionId) internal view returns (IndependentContribution storage) {
    if (contributionId >= _contributions.length) revert InvalidContribution();
    return _contributions[contributionId];
  }

  function _assignValidators() internal view returns (address[] memory assigned) {
    uint256 validatorCount = _validatorList.length;
    if (validatorCount == 0) {
      return new address[](0);
    }

    uint256 count = maxValidators < validatorCount ? maxValidators : validatorCount;
    assigned = new address[](count);
    
    uint256 startIndex = _nextValidatorIndex % validatorCount;
    for (uint256 i = 0; i < count; i++) {
      assigned[i] = _validatorList[(startIndex + i) % validatorCount];
    }
  }

  function _isAssignedValidator(uint256 contributionId, address validator) internal view returns (bool) {
    address[] memory assigned = _contributionValidators[contributionId];
    for (uint256 i = 0; i < assigned.length; i++) {
      if (assigned[i] == validator) {
        return true;
      }
    }
    return false;
  }

  function _checkAndFinalize(uint256 contributionId) internal {
    IndependentContribution storage contrib = _getContribution(contributionId);
    
    if (contrib.status != ContributionStatus.UnderReview) {
      return;
    }

    bool approved = contrib.approvalCount >= minValidatorsRequired;
    
    if (approved) {
      contrib.status = ContributionStatus.Approved;
      if (contrib.rewardAmount > 0 && communityPool != address(0)) {
        uint256 poolBalance = elusivToken.balanceOf(communityPool);
        if (poolBalance >= contrib.rewardAmount) {
          contributorStats[contrib.contributor] += contrib.rewardAmount;
          ICommunityPool(communityPool).withdraw(contrib.contributor, contrib.rewardAmount);
          emit RewardDistributed(contributionId, contrib.contributor, contrib.rewardAmount);
        }
      }
    } else {
      contrib.status = ContributionStatus.Rejected;
    }

    emit ContributionFinalized(contributionId, approved, contrib.rewardAmount);
  }

  function _removeFromValidatorList(address validator) internal {
    uint256 length = _validatorList.length;
    for (uint256 i = 0; i < length; i++) {
      if (_validatorList[i] == validator) {
        _validatorList[i] = _validatorList[length - 1];
        _validatorList.pop();
        break;
      }
    }
  }

  function _getApprovedContributionCount(address contributor) internal view returns (uint256 count) {
    for (uint256 i = 0; i < _contributions.length; i++) {
      if (_contributions[i].contributor == contributor && _contributions[i].status == ContributionStatus.Approved) {
        count++;
      }
    }
  }

  function _sortContributorsByValue(ContributorStats[] memory stats) internal pure {
    uint256 n = stats.length;
    for (uint256 i = 0; i < n - 1; i++) {
      for (uint256 j = 0; j < n - i - 1; j++) {
        if (stats[j].totalValue < stats[j + 1].totalValue) {
          ContributorStats memory temp = stats[j];
          stats[j] = stats[j + 1];
          stats[j + 1] = temp;
        }
      }
    }
  }
}
